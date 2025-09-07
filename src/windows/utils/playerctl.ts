import { spawn } from "child_process";
import * as vscode from 'vscode';
import FIND_FILE_PATHS from "../../utils/findFilePaths";

class playerCtrlLinux {

    private isPlayerCtrlAvailableFlag: boolean | null = null;
    private extensionContext: vscode.ExtensionContext | null = null;

    constructor() {
        this.isPlyerCtrlAvailable();
    }

    // Method to set the extension context
    setExtensionContext(context: vscode.ExtensionContext) {
        this.extensionContext = context;
    }

    // This class will handle communication with Playerctl 
    async isPlyerCtrlAvailable(): Promise<boolean> {
        // Check if playerctl is installed on the system
        const playerCtrl = spawn("playerctl", ["--version"]);
        console.log("Checking if playerctl is available on the system...");
        playerCtrl.stdout.on("data", (data) => {
            console.log("Info got from playerctl --version command:" + data);
        });
        const isAvailable: boolean = await new Promise((resolve) => {
            playerCtrl.on("error", () => resolve(false));
            playerCtrl.on("exit", (code) => resolve(code === 0));
        });
        this.isPlayerCtrlAvailableFlag = isAvailable;
        return isAvailable;
    }


    async getCurrentTrackInfo(): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.isPlayerCtrlAvailableFlag === false) {
                reject("playerctl is not available on this system.");
                return;
            }
            const playerCtrl = spawn("playerctl", [
                'metadata',
                '--format',
                '{{title}}|{{mpris:artUrl }}|{{artist}}|{{album}}|{{duration(position)}}|{{duration(mpris:length)}}|{{status}}'
            ]);
            let trackInfo = "";
            playerCtrl.stdout.on("data", (data) => {
                trackInfo += data.toString();
            });
            playerCtrl.stderr.on("data", (data) => {
                console.error(`Error: ${data}`);
            });
            playerCtrl.on("close", (code) => {
                if (code === 0) {
                    resolve(trackInfo.trim());
                } else {
                    reject(`playerctl process exited with code ${code}`);
                }
            });
        });
    }
    async testPy() {
        const pythonProcess = spawn('python3', ['-c', 'print("Hello from Python")']);
        pythonProcess.stdout.on('data', (data) => {
            console.log(`Python Output: ${data}`);
        });
        pythonProcess.stderr.on('data', (data) => {
            console.error(`Python Error: ${data}`);
        });
        pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
        });

        let pythonFilePath = FIND_FILE_PATHS.getPath(
            this.extensionContext,
            'test.py'
        )

        // Run the Python file
        const runPyFile = spawn('python3', [pythonFilePath]);
        runPyFile.stdout.on('data', (data) => {
            console.log(`Output from test.py: ${data}`);
        });
        runPyFile.stderr.on('data', (data) => {
            console.error(`Error from test.py: ${data}`);
        });
        runPyFile.on('close', (code) => {
            console.log(`test.py process exited with code ${code}`);
        });
    }


    dispose() {
        // Clean up resources if needed
    }


}


const PLAYER_CONTROLLER_LINUX = new playerCtrlLinux();
export default PLAYER_CONTROLLER_LINUX;