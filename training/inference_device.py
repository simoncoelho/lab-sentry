"""CPU is a supported inference target; CUDA remains optional."""
import os


def inference_device():
    import torch
    requested = os.environ.get('LAB_SENTRY_DEVICE', 'auto').lower()
    if requested not in ('auto', 'cpu', 'cuda'):
        raise ValueError('LAB_SENTRY_DEVICE must be auto, cpu, or cuda')
    if requested == 'cuda' and not torch.cuda.is_available():
        raise ValueError('CUDA requested but unavailable. Use LAB_SENTRY_DEVICE=cpu.')
    return 0 if requested != 'cpu' and torch.cuda.is_available() else 'cpu'
