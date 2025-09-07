import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { TrackInfo } from '../common/interfaces/musicController';

export { TrackInfo };

export class WindowsMusicService {
    private updateInterval: NodeJS.Timeout | null = null;
    private currentTrack: TrackInfo | null = null;
    private onTrackChangedCallback?: (track: TrackInfo | null) => void;
    private onPositionChangedCallback?: (position: number) => void;
    private isWinKlangAvailable = false;
    private extensionContext: vscode.ExtensionContext;
    private artworkCache = new Map<string, string>();
    private winKlangPath: string;

    constructor(context: vscode.ExtensionContext) {
        this.extensionContext = context;
        this.winKlangPath = path.join(this.extensionContext.extensionPath, 'dist', 'src', 'windows', 'WinKlang.exe');
        this.initialize();
    }

    public async initialize() {
        await this.checkWinKlangAvailability();
        this.startPolling();
    }

    private async checkWinKlangAvailability(): Promise<void> {
        return new Promise((resolve) => {
            // Check if WinKlang.exe exists and is executable
            if (!fs.existsSync(this.winKlangPath)) {
                console.warn('Windows Music Service: WinKlang.exe not found at', this.winKlangPath);
                this.isWinKlangAvailable = false;
                resolve();
                return;
            }

            // Test if WinKlang can be executed
            const winKlang = spawn(this.winKlangPath, ['--json']);

            winKlang.on('exit', (code) => {
                this.isWinKlangAvailable = code === 0;
                if (!this.isWinKlangAvailable) {
                    console.warn('Windows Music Service: WinKlang.exe not available - music controls will be limited');
                }
                resolve();
            });

            winKlang.on('error', (error) => {
                console.warn('Windows Music Service: Error running WinKlang.exe:', error.message);
                this.isWinKlangAvailable = false;
                resolve();
            });
        });
    }

    private startPolling() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(async () => {
            try {
                const track = await this.getCurrentTrack();

                if (this.hasTrackChanged(track)) {
                    this.currentTrack = track;

                    // Download and cache artwork if available
                    if (track && track.artUrl) {
                        const artworkPath = await this.downloadArtwork(track.artUrl);
                        if (artworkPath) {
                            track.artUrl = artworkPath;
                        }
                    }

                    this.onTrackChangedCallback?.(track);
                }
            } catch (error) {
                // Track changed to null or error occurred
                if (this.currentTrack !== null) {
                    this.currentTrack = null;
                    this.onTrackChangedCallback?.(null);
                }
            }
        }, 1000);
    }

    private hasTrackChanged(newTrack: TrackInfo | null): boolean {
        if (!this.currentTrack && !newTrack) {
            return false;
        }

        if (!this.currentTrack || !newTrack) {
            return true;
        }

        return (
            this.currentTrack.title !== newTrack.title ||
            this.currentTrack.artist !== newTrack.artist ||
            this.currentTrack.status !== newTrack.status ||
            Math.abs((this.currentTrack.position || 0) - (newTrack.position || 0)) > 2
        );
    }

    public async getCurrentTrack(): Promise<TrackInfo | null> {
        if (!this.isWinKlangAvailable) {
            return null;
        }

        return new Promise((resolve, reject) => {
            const winKlang = spawn(this.winKlangPath, ['--json']);

            let output = '';
            winKlang.stdout.on('data', (data) => {
                output += data.toString();
            });

            winKlang.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    try {
                        const data = JSON.parse(output.trim());

                        // Map WinKlang JSON response to TrackInfo interface
                        const track: TrackInfo = {
                            title: data.title || 'Unknown Title',
                            artUrl: data.artworkUri || '',
                            artist: data.artist || 'Unknown Artist',
                            album: data.album || 'Unknown Album',
                            position: this.parseTimeToSeconds(data.currentTime || '00:00'),
                            duration: this.parseTimeToSeconds(data.duration || '00:00'),
                            status: this.mapPlaybackStatus(data.status),
                            player: 'Windows Media Session'
                        };
                        resolve(track);
                    } catch (error) {
                        console.error('Failed to parse WinKlang JSON output:', error);
                        console.error('Raw output was:', JSON.stringify(output));
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });

            winKlang.on('error', (error) => {
                console.error('Error running WinKlang:', error);
                resolve(null);
            });
        });
    }

    private parseTimeToSeconds(timeString: string): number {
        if (!timeString || timeString === '00:00') {
            return 0;
        }

        const parts = timeString.split(':');
        if (parts.length === 2) {
            const minutes = parseInt(parts[0], 10) || 0;
            const seconds = parseInt(parts[1], 10) || 0;
            return minutes * 60 + seconds;
        }
        return 0;
    }

    private mapPlaybackStatus(status: string): 'playing' | 'paused' | 'stopped' {
        if (!status) return 'stopped';

        const normalizedStatus = status.toLowerCase();
        if (normalizedStatus.includes('play')) return 'playing';
        if (normalizedStatus.includes('pause')) return 'paused';
        return 'stopped';
    }

    private async downloadArtwork(artworkUrl: string): Promise<string | null> {
        if (!artworkUrl) {
            return null;
        }

        // Check cache first
        if (this.artworkCache.has(artworkUrl)) {
            return this.artworkCache.get(artworkUrl)!;
        }

        try {
            // Handle file:// URLs (common with GSConnect)
            if (artworkUrl.startsWith('file://')) {
                const filePath = artworkUrl.replace('file://', '');
                if (fs.existsSync(filePath)) {
                    const uploadsDir = path.join(this.extensionContext.globalStorageUri.fsPath, 'uploads');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }

                    const fileName = path.basename(filePath);
                    const targetPath = path.join(uploadsDir, fileName);

                    // Copy file to extension storage
                    fs.copyFileSync(filePath, targetPath);

                    // Create vscode URI for webview
                    const webviewUri = vscode.Uri.file(targetPath).with({ scheme: 'vscode-resource' });
                    this.artworkCache.set(artworkUrl, webviewUri.toString());
                    return webviewUri.toString();
                }
                return null;
            }

            // Handle HTTP/HTTPS URLs
            if (artworkUrl.startsWith('http')) {
                const uploadsDir = path.join(this.extensionContext.globalStorageUri.fsPath, 'uploads');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }

                const fileName = `artwork_${Date.now()}.jpg`;
                const filePath = path.join(uploadsDir, fileName);

                await this.downloadFile(artworkUrl, filePath);

                const webviewUri = vscode.Uri.file(filePath).with({ scheme: 'vscode-resource' });
                this.artworkCache.set(artworkUrl, webviewUri.toString());
                return webviewUri.toString();
            }
            console.log('Unsupported artwork URL scheme:', artworkUrl);


            return null;
        } catch (error) {
            console.error('Error downloading artwork:', error);
            return null;
        }
    }

    private downloadFile(url: string, filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;

            protocol.get(url, (response) => {
                if (response.statusCode === 200) {
                    const fileStream = fs.createWriteStream(filePath);
                    response.pipe(fileStream);

                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });

                    fileStream.on('error', reject);
                } else {
                    reject(new Error(`HTTP ${response.statusCode}`));
                }
            }).on('error', reject);
        });
    }

    // Control methods
    public async playPause(): Promise<void> {
        if (!this.isWinKlangAvailable) {
            vscode.window.showWarningMessage('WinKlang is not available. Please ensure WinKlang.exe is present to control music playback.');
            return;
        }

        return new Promise((resolve, reject) => {
            const winKlang = spawn(this.winKlangPath, ['--play-pause']);
            winKlang.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`WinKlang play-pause failed with code ${code}`));
                }
            });
            winKlang.on('error', (error) => {
                reject(new Error(`WinKlang play-pause error: ${error.message}`));
            });
        });
    }

    public async next(): Promise<void> {
        if (!this.isWinKlangAvailable) {
            vscode.window.showWarningMessage('WinKlang is not available. Please ensure WinKlang.exe is present to control music playback.');
            return;
        }

        return new Promise((resolve, reject) => {
            const winKlang = spawn(this.winKlangPath, ['--next']);

            let errorOutput = '';
            winKlang.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            winKlang.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    // Check if it's a "not available" error rather than a real failure
                    if (errorOutput.includes('not available')) {
                        vscode.window.showInformationMessage('Next track control is not available for the current media player.');
                        resolve(); // Don't reject for unavailable controls
                    } else {
                        reject(new Error(`WinKlang next failed with code ${code}: ${errorOutput}`));
                    }
                }
            });
            winKlang.on('error', (error) => {
                reject(new Error(`WinKlang next error: ${error.message}`));
            });
        });
    }

    public async previous(): Promise<void> {
        if (!this.isWinKlangAvailable) {
            vscode.window.showWarningMessage('WinKlang is not available. Please ensure WinKlang.exe is present to control music playback.');
            return;
        }

        return new Promise((resolve, reject) => {
            const winKlang = spawn(this.winKlangPath, ['--prev']);

            let errorOutput = '';
            winKlang.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            winKlang.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    // Check if it's a "not available" error rather than a real failure
                    if (errorOutput.includes('not available')) {
                        vscode.window.showInformationMessage('Previous track control is not available for the current media player.');
                        resolve(); // Don't reject for unavailable controls
                    } else {
                        reject(new Error(`WinKlang previous failed with code ${code}: ${errorOutput}`));
                    }
                }
            });
            winKlang.on('error', (error) => {
                reject(new Error(`WinKlang previous error: ${error.message}`));
            });
        });
    }

    public async getPosition(): Promise<number | null> {
        if (!this.isWinKlangAvailable) {
            return null;
        }

        // WinKlang doesn't have a separate position command, so we get it from the full track info
        const track = await this.getCurrentTrack();
        return track?.position || null;
    }

    // Event handlers
    public onTrackChanged(callback: (track: TrackInfo | null) => void) {
        this.onTrackChangedCallback = callback;
    }

    public onPositionChanged(callback: (position: number) => void) {
        this.onPositionChangedCallback = callback;
    }

    // Getters
    public get currentTrackInfo(): TrackInfo | null {
        return this.currentTrack;
    }

    public get isAvailable(): boolean {
        return this.isWinKlangAvailable;
    }

    public dispose() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.artworkCache.clear();
    }
}