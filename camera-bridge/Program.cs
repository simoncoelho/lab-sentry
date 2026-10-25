using Obsbot.Control;


var builder = WebApplication.CreateBuilder(args);
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.WebHost.UseUrls("http://127.0.0.1:5101");
builder.Services.AddSingleton<IObsbotCameraDriver, DirectShowObsbotCameraDriver>();
builder.Services.AddSingleton<LiveMotion>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<LiveMotion>());
var app = builder.Build();
var live = app.Services.GetRequiredService<LiveMotion>();
var gate = live.DeviceGate;

app.Use(async (context, next) => {
    var origin = context.Request.Headers.Origin.ToString();
    if (!System.Net.IPAddress.IsLoopback(context.Connection.RemoteIpAddress!) ||
        (origin.Length > 0 && origin != "http://127.0.0.1:5173" && origin != "http://localhost:5173") ||
        (context.Request.Method == "POST" && !context.Request.HasJsonContentType())) {
        context.Response.StatusCode = 403; return;
    }
    await next(context);
});
app.MapGet("/state", (IObsbotCameraDriver driver) => Results.Ok(new { state = driver.State, motion = live.Status }));
app.MapPost("/connect", async (IObsbotCameraDriver driver) => {
    if (!await gate.WaitAsync(0)) return Results.Conflict(new { error = "Camera is busy." });
    try {
        var devices = await driver.DiscoverDevicesAsync();
        var camera = devices.FirstOrDefault(d => d.DisplayName.Contains("OBSBOT", StringComparison.OrdinalIgnoreCase)
            && !d.DisplayName.Contains("Virtual", StringComparison.OrdinalIgnoreCase));
        if (camera is null) return Results.NotFound(new { error = "No physical OBSBOT camera found. Connect it by USB." });
        await driver.ConnectAsync(camera.DevicePath);
        return Results.Ok(await driver.RefreshStateAsync());
    } catch (Exception e) { return Results.BadRequest(new { error = e.Message }); }
    finally { gate.Release(); }
});
app.MapPost("/target", (Target target, IObsbotCameraDriver driver) => {
        if (!driver.State.IsConnected) return Results.BadRequest(new { error = "Connect camera controls first." });
        foreach (var (kind, value) in new[] { (CameraControlKind.Pan, target.Pan), (CameraControlKind.Tilt, target.Tilt) }) {
            var range = driver.State.Controls.GetValueOrDefault(kind)?.Range;
            if (range is null || value < range.Min || value > range.Max || (range.Step > 0 && (value - range.Min) % range.Step != 0))
                return Results.BadRequest(new { error = $"{kind} is outside the hardware range or step." });
        }
    if (target.Zoom is int zoom) {
        var range = driver.State.Controls.GetValueOrDefault(CameraControlKind.Zoom)?.Range;
        if (range is null || zoom < range.Min || zoom > range.Max || (range.Step > 0 && (zoom - range.Min) % range.Step != 0))
            return Results.BadRequest(new { error = "Zoom is outside the hardware range or step." });
    }
    live.SetTarget(target);
    return Results.Accepted();
});
app.MapPost("/stop", async (IObsbotCameraDriver driver) => {
    await live.Halt();
    return Results.Ok(driver.State);
});
app.Run();
record Target(int Pan, int Tilt, int? Zoom = null);

