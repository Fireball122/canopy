using System.Diagnostics;
using System.Net.NetworkInformation;

namespace Canopy.Services;

public sealed record WifiThroughputSnapshot(
    bool available,
    string adapter_id,
    double rx_kbps,
    double tx_kbps);

/// <summary>
/// Derives Wi-Fi receive/transmit rates from the wireless adapter's byte counters.
/// Rates are deltas between consecutive calls; a gap longer than MaxSampleGapMs
/// (view unmounted, machine asleep) or a changed adapter restarts the baseline
/// so a stale average is never reported as a live rate.
/// </summary>
public static class WifiThroughputSampler
{
    private const double MaxSampleGapMs = 5000;

    private static readonly object Gate = new();
    private static string _lastId = string.Empty;
    private static long _lastRx;
    private static long _lastTx;
    private static long _lastTickMs = -1;
    private static readonly Stopwatch Clock = Stopwatch.StartNew();

    public static WifiThroughputSnapshot Sample()
    {
        NetworkInterface? nic = FindWirelessAdapter();
        if (nic is null)
        {
            lock (Gate)
            {
                _lastId = string.Empty;
                _lastTickMs = -1;
            }
            return new WifiThroughputSnapshot(false, string.Empty, 0, 0);
        }

        IPv4InterfaceStatistics stats = nic.GetIPv4Statistics();
        long rx = stats.BytesReceived;
        long tx = stats.BytesSent;
        string id = nic.Id;
        long now = Clock.ElapsedMilliseconds;

        lock (Gate)
        {
            bool hasBaseline = _lastTickMs >= 0
                && _lastId == id
                && now > _lastTickMs
                && now - _lastTickMs <= MaxSampleGapMs;

            double rxKbps = 0;
            double txKbps = 0;
            if (hasBaseline)
            {
                double seconds = (now - _lastTickMs) / 1000.0;
                // Counter reset (driver reload, adapter re-enumerated) would go negative; clamp to zero.
                rxKbps = Math.Max(0, rx - _lastRx) / 1024.0 / seconds;
                txKbps = Math.Max(0, tx - _lastTx) / 1024.0 / seconds;
            }

            _lastId = id;
            _lastRx = rx;
            _lastTx = tx;
            _lastTickMs = now;

            return new WifiThroughputSnapshot(true, id, rxKbps, txKbps);
        }
    }

    private static NetworkInterface? FindWirelessAdapter()
    {
        foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211
                && nic.OperationalStatus == OperationalStatus.Up)
            {
                return nic;
            }
        }
        return null;
    }
}
