import { BrowserActionableElement, BrowserFormModel } from '../../shared/types/browserIntelligence';
export type WebIntentOpcode = 'NAVIGATE' | 'WAIT' | 'ASSERT' | 'INTENT.LOGIN' | 'INTENT.ACCEPT_DIALOG' | 'INTENT.DISMISS_DIALOG' | 'INTENT.HOVER' | 'INTENT.DRAG_DROP' | 'INTENT.ADD_TO_CART' | 'INTENT.OPEN_CART' | 'INTENT.FILL_CHECKOUT_INFO' | 'INTENT.FINISH_ORDER' | 'INTENT.UPLOAD' | 'INTENT.CHECKOUT' | 'INTENT.EXTRACT';
export type WebIntentInstruction = {
    op: WebIntentOpcode | string;
    args?: Record<string, unknown>;
};
export type WebIntentProgram = {
    instructions: WebIntentInstruction[];
    tabId?: string;
    failFast?: boolean;
};
export type WebIntentStepResult = {
    index: number;
    op: string;
    status: 'ok' | 'failed';
    durationMs: number;
    evidence: string;
    data?: Record<string, unknown>;
    error?: string;
};
export type WebIntentRunResult = {
    success: boolean;
    steps: WebIntentStepResult[];
    extracted: Array<Record<string, unknown>>;
    finalUrl: string;
    failedAt: number | null;
};
export type WebIntentPageState = {
    url: string;
    title: string;
    text: string;
    mainHeading?: string;
};
export type WebIntentAdapter = {
    navigate: (url: string, tabId?: string) => Promise<void>;
    waitForSettled: (timeoutMs?: number) => Promise<void>;
    getCurrentUrl: (tabId?: string) => Promise<string>;
    readPageState: (tabId?: string) => Promise<WebIntentPageState>;
    getDialogs: (tabId?: string) => Promise<Array<{
        id: string;
        type: string;
        message: string;
        defaultPrompt?: string;
    }>>;
    acceptDialog: (input: {
        tabId?: string;
        dialogId?: string;
        promptText?: string;
    }) => Promise<{
        accepted: boolean;
        error: string | null;
    }>;
    dismissDialog: (input: {
        tabId?: string;
        dialogId?: string;
    }) => Promise<{
        dismissed: boolean;
        error: string | null;
    }>;
    getActionableElements: (tabId?: string) => Promise<BrowserActionableElement[]>;
    getFormModel: (tabId?: string) => Promise<BrowserFormModel[]>;
    click: (selector: string, tabId?: string) => Promise<{
        clicked: boolean;
        error: string | null;
    }>;
    type: (selector: string, text: string, tabId?: string) => Promise<{
        typed: boolean;
        error: string | null;
    }>;
    upload: (selector: string, filePath: string, tabId?: string) => Promise<{
        uploaded: boolean;
        error: string | null;
    }>;
    hover: (selector: string, tabId?: string) => Promise<{
        hovered: boolean;
        error: string | null;
    }>;
    drag: (sourceSelector: string, targetSelector: string, tabId?: string) => Promise<{
        dragged: boolean;
        error: string | null;
    }>;
    executeInPage: (expression: string, tabId?: string) => Promise<{
        result: unknown;
        error: string | null;
    }>;
};
export declare class WebIntentVM {
    private readonly adapter;
    constructor(adapter: WebIntentAdapter);
    run(program: WebIntentProgram): Promise<WebIntentRunResult>;
    private executeInstruction;
    private executeNavigate;
    private executeWait;
    private executeAssert;
    private executeLogin;
    private executeAcceptDialog;
    private executeDismissDialog;
    private executeUpload;
    private executeHover;
    private executeDragDrop;
    private executeAddToCart;
    private executeOpenCart;
    private executeCheckout;
    private executeFillCheckoutInfo;
    private executeFinishOrder;
    private executeExtract;
    private readAuthState;
    private extractStructuredData;
    private selectRequestedFields;
    private readCartState;
    private resolveHoverTargetFromDom;
    private resolveDragDropTargetsFromDom;
    private resolveLoginTargetsFromDom;
    private resolveCheckoutInfoTargetsFromDom;
}
