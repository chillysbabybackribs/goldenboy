import { BrowserDownloadState } from '../../shared/types/browser';
export declare function getDownloadDir(): string;
export declare function createDownloadEntry(url: string, filename: string, savePath: string): BrowserDownloadState;
export declare function resolveDownloadPath(suggestedFilename: string): string;
