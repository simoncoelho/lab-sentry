using System.Threading.Channels;
using Obsbot.Control;
using Obsbot.Motion;

// One active move and one replaceable target. Never replay a drag history.
sealed class LiveMotion(IObsbotCameraDriver driver) : BackgroundService
{
    readonly Channel<(long Version, Target Target)> queue = Channel.CreateBounded<(long, Target)>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = false });
    readonly object sync = new();
    public SemaphoreSlim DeviceGate { get; } = new(1);
    CancellationTokenSource? current;
    long version;
    string? error;
    bool moving;
    public object Status { get { lock (sync) return new { moving, error }; } }

    public void SetTarget(Target target)
    {
        lock (sync) {
            error = null; moving = true;
            queue.Writer.TryWrite((++version, target));
            current?.Cancel();
        }
    }

    public async Task Halt()
    {
        lock (sync) {
            ++version;
            while (queue.Reader.TryRead(out _)) { }
            current?.Cancel(); moving = false; error = null;
        }
        // Wait until the canceled controller's final stop has finished before
        // returning; no old move can stop a subsequent move after this barrier.
        await DeviceGate.WaitAsync();
        try { await driver.StopAsync(); }
        finally { DeviceGate.Release(); }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var item in queue.Reader.ReadAllAsync(stoppingToken)) {
            await DeviceGate.WaitAsync(stoppingToken);
            CancellationTokenSource? cancellation = null;
            try {
                lock (sync) {
                    if (item.Version != version) continue;
                    current = cancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                }
                // Repeated feedback-guided setpoints recover from firmware that
                // accepts a single absolute command but stops short of its target.
                var profile = new MotionProfile("live_setpoint", ControlMode: MotionControlMode.AbsoluteSetpoint,
                    MinPanSpeed: 10, MaxPanSpeed: 28, MinTiltSpeed: 6, MaxTiltSpeed: 20,
                    SlowZone: 55, MaxPanStepChange: 8, MaxTiltStepChange: 7,
                    Tolerance: 2, StableSamples: 2, NoProgressSamples: 60,
                    SampleInterval: TimeSpan.FromMilliseconds(40), Timeout: TimeSpan.FromSeconds(8));
                var run = await new TeachPointMotionController(driver).MoveToAsync(
                    new TeachPoint("Live camera", item.Target.Pan, item.Target.Tilt,
                        item.Target.Zoom == driver.State.Controls.GetValueOrDefault(CameraControlKind.Zoom)?.Value ? null : item.Target.Zoom), profile, cancellation.Token);
                lock (sync) { if (item.Version == version) { moving = false; error = run.Success ? null : run.Message; } }
            } catch (OperationCanceledException) { }
            catch (Exception e) { lock (sync) { if (item.Version == version) { error = e.Message; moving = false; } } }
            finally {
                lock (sync) { if (ReferenceEquals(current, cancellation)) current = null; cancellation?.Dispose(); }
                DeviceGate.Release();
            }
        }
    }
}

