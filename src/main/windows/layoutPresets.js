"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultWindowBounds = getDefaultWindowBounds;
const electron_1 = require("electron");
function classifyDisplays() {
    const displays = electron_1.screen.getAllDisplays();
    if (displays.length === 1) {
        return { topDisplay: displays[0], bottomDisplay: displays[0], isSingleMonitor: true };
    }
    const primary = electron_1.screen.getPrimaryDisplay();
    const external = displays.find((d) => d.id !== primary.id) ?? primary;
    return {
        topDisplay: external,
        bottomDisplay: primary,
        isSingleMonitor: false,
    };
}
function getDefaultWindowBounds() {
    const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
    const top = topDisplay.workArea;
    const bottom = bottomDisplay.workArea;
    const documentWidth = Math.floor(bottom.width * 0.72);
    const documentHeight = Math.floor(bottom.height * 0.82);
    const documentX = bottom.x + Math.floor((bottom.width - documentWidth) / 2);
    const documentY = bottom.y + Math.floor((bottom.height - documentHeight) / 2);
    if (isSingleMonitor) {
        const totalH = top.height;
        const commandH = Math.floor(totalH * 0.33);
        const executionH = totalH - commandH;
        return {
            execution: { x: top.x, y: top.y, width: top.width, height: executionH, displayId: topDisplay.id },
            command: { x: bottom.x, y: top.y + executionH, width: top.width, height: commandH, displayId: bottomDisplay.id },
            document: { x: documentX, y: documentY, width: documentWidth, height: documentHeight, displayId: bottomDisplay.id },
        };
    }
    return {
        execution: { x: top.x, y: top.y, width: top.width, height: top.height, displayId: topDisplay.id },
        command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
        document: { x: documentX, y: documentY, width: documentWidth, height: documentHeight, displayId: bottomDisplay.id },
    };
}
//# sourceMappingURL=layoutPresets.js.map