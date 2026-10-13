using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows.Media.Imaging;

namespace CaelestiaWin.Models;

public sealed class WallpaperItem : INotifyPropertyChanged
{
    private BitmapSource? _thumbnail;
    private bool _isActive;
    private bool _isLoading = true;

    public required string FileName { get; init; }
    public required string FullPath { get; init; }
    public string DisplayName => Path.GetFileNameWithoutExtension(FileName);
    public string ExtensionBadge => Path.GetExtension(FileName).TrimStart('.').ToUpperInvariant();

    public BitmapSource? Thumbnail
    {
        get => _thumbnail;
        set
        {
            if (!ReferenceEquals(_thumbnail, value))
            {
                _thumbnail = value;
                OnPropertyChanged();
            }
        }
    }

    public bool IsActive
    {
        get => _isActive;
        set
        {
            if (_isActive != value)
            {
                _isActive = value;
                OnPropertyChanged();
            }
        }
    }

    public bool IsLoading
    {
        get => _isLoading;
        set
        {
            if (_isLoading != value)
            {
                _isLoading = value;
                OnPropertyChanged();
            }
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
