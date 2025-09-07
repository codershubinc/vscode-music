import * as vscode from 'vscode';

export interface TrackInfo {
    title: string;
    artUrl: string;
    artist: string;
    album: string;
    duration?: number;
    position?: number;
    status: 'playing' | 'paused' | 'stopped';
    player?: string;
}

/**
 * Common interface that all platform-specific music controllers must implement
 * This ensures consistent API across Linux, Windows, and macOS implementations
 */
export interface IMusicController {
    /**
     * Get current track information including metadata
     */
    getCurrentTrack(): Promise<TrackInfo | null>;

    /**
     * Get current playback position in seconds
     */
    getPosition(): Promise<number | null>;

    /**
     * Toggle play/pause state
     */
    playPause(): Promise<void>;

    /**
     * Skip to next track
     */
    next(): Promise<void>;

    /**
     * Skip to previous track
     */
    previous(): Promise<void>;

    /**
     * Check if music service is available on this platform
     */
    isAvailable(): boolean;

    /**
     * Get processed artwork URI for webview display
     */
    getArtworkUri(artUrl: string, webview: vscode.Webview): Promise<string>;

    /**
     * Clean up resources when disposing
     */
    dispose(): void;
}