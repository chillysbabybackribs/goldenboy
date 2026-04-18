"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = generateId;
let counter = 0;
function generateId(prefix = 'id') {
    counter++;
    return `${prefix}_${Date.now()}_${counter}`;
}
//# sourceMappingURL=ids.js.map