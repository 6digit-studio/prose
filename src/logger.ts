/**
 * Prose Logger - Centralized log level management
 */

export enum LogLevel {
    SILENT = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    VERBOSE = 4,
    TRACE = 5,
}

let currentLogLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
    currentLogLevel = level;
}

export function error(message: string, ...args: any[]): void {
    if (currentLogLevel >= LogLevel.ERROR) {
        console.error(`❌ ${message}`, ...args);
    }
}

export function warn(message: string, ...args: any[]): void {
    if (currentLogLevel >= LogLevel.WARN) {
        console.warn(`⚠️  ${message}`, ...args);
    }
}

export function info(message: string, ...args: any[]): void {
    if (currentLogLevel >= LogLevel.INFO) {
        console.log(message, ...args);
    }
}

export function success(message: string, ...args: any[]): void {
    if (currentLogLevel >= LogLevel.INFO) {
        console.log(`✅ ${message}`, ...args);
    }
}

export function verbose(message: string, ...args: any[]): void {
    if (currentLogLevel >= LogLevel.VERBOSE) {
        console.log(`ℹ️  ${message}`, ...args);
    }
}

export function trace(message: string, ...args: any[]): void {
    if (currentLogLevel >= LogLevel.TRACE) {
        console.log(`🔍 [TRACE] ${message}`, ...args);
    }
}

export function getLogLevel(): LogLevel {
    return currentLogLevel;
}
