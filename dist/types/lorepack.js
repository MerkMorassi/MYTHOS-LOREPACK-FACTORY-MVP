export var ConnectionState;
(function (ConnectionState) {
    ConnectionState["DISCONNECTED"] = "DISCONNECTED";
    ConnectionState["CONNECTING"] = "CONNECTING";
    ConnectionState["CONNECTED"] = "CONNECTED";
    ConnectionState["ERROR"] = "ERROR";
})(ConnectionState || (ConnectionState = {}));
export const DEFAULT_MODEL_CONFIG = {
    temperature: 0.7,
    topP: 0.95,
    topK: 40,
};
export const DEFAULT_SOVEREIGN_CONFIG = {
    mode: 'PRESET',
    preset: 'Nexus Prime',
    customGreeting: ''
};
export var SomaActionType;
(function (SomaActionType) {
    SomaActionType["QUERY_DB"] = "QUERY_DB";
    SomaActionType["INGEST_DATA"] = "INGEST_DATA";
    SomaActionType["DELETE_DATA"] = "DELETE_DATA";
    SomaActionType["EXEC_CODE"] = "EXEC_CODE";
    SomaActionType["ROUTE_REQUEST"] = "ROUTE_REQUEST";
    SomaActionType["CREATE_IMAGE"] = "CREATE_IMAGE";
    SomaActionType["SYSTEM_ADMIN"] = "SYSTEM_ADMIN";
    SomaActionType["BROADCAST"] = "BROADCAST";
    SomaActionType["PUBLISH_CANON"] = "PUBLISH_CANON";
    SomaActionType["DELEGATE_TASK"] = "DELEGATE_TASK";
    SomaActionType["COLLABORATE"] = "COLLABORATE";
})(SomaActionType || (SomaActionType = {}));
export var ProductionStage;
(function (ProductionStage) {
    ProductionStage["IDEATION"] = "IDEATION";
    ProductionStage["SCRIPT"] = "SCRIPT";
    ProductionStage["DESIGN"] = "DESIGN";
    ProductionStage["ART"] = "ART";
})(ProductionStage || (ProductionStage = {}));
export var ApprovalStatus;
(function (ApprovalStatus) {
    ApprovalStatus["DRAFT"] = "DRAFT";
    ApprovalStatus["PENDING"] = "PENDING";
    ApprovalStatus["APPROVED"] = "APPROVED";
    ApprovalStatus["REJECTED"] = "REJECTED";
})(ApprovalStatus || (ApprovalStatus = {}));
