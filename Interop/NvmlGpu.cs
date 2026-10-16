using System.Runtime.InteropServices;

namespace Canopy.Interop;

/// <summary>
/// Minimal NVML reader for GPU temperature. Windows performance counters expose GPU utilisation
/// but never temperature, and spawning <c>nvidia-smi.exe</c> on every sample is exactly the
/// dGPU wake-up this service avoids — so the driver's own library is loaded lazily instead.
/// Every path degrades to <c>null</c>: no NVIDIA driver, no DLL, or an unsupported entry point
/// simply leaves the temperature unread rather than fabricating one.
/// </summary>
internal static class NvmlGpu
{
    private const int NvmlSuccess = 0;
    private const int NvmlTemperatureGpu = 0;

    [DllImport("nvml.dll", EntryPoint = "nvmlInit_v2")]
    private static extern int NvmlInit();

    [DllImport("nvml.dll", EntryPoint = "nvmlDeviceGetHandleByIndex_v2")]
    private static extern int NvmlDeviceGetHandleByIndex(uint index, out IntPtr device);

    [DllImport("nvml.dll", EntryPoint = "nvmlDeviceGetTemperature")]
    private static extern int NvmlDeviceGetTemperature(IntPtr device, int sensorType, out uint temperature);

    private static readonly object Gate = new();
    private static bool _probed;
    private static IntPtr _device;

    public static double? TryReadTemperatureCelsius()
    {
        lock (Gate)
        {
            if (!_probed)
            {
                _probed = true;
                try
                {
                    if (NvmlInit() != NvmlSuccess)
                    {
                        _device = IntPtr.Zero;
                    }
                    else if (NvmlDeviceGetHandleByIndex(0, out IntPtr device) != NvmlSuccess)
                    {
                        _device = IntPtr.Zero;
                    }
                    else
                    {
                        _device = device;
                    }
                }
                catch (Exception)
                {
                    // DllNotFound / EntryPointNotFound on non-NVIDIA machines: stay unread.
                    _device = IntPtr.Zero;
                }
            }

            if (_device == IntPtr.Zero)
                return null;

            try
            {
                return NvmlDeviceGetTemperature(_device, NvmlTemperatureGpu, out uint celsius) == NvmlSuccess
                    ? celsius
                    : null;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
