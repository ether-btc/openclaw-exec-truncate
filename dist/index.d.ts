interface GitDiffConfig {
    enabled?: boolean;
    headLines?: number;
    tailLines?: number;
}
interface GitLogConfig {
    enabled?: boolean;
    maxLines?: number;
}
interface GrepConfig {
    enabled?: boolean;
    maxMatches?: number;
}
interface LsConfig {
    enabled?: boolean;
    maxEntries?: number;
}
interface BuildConfig {
    enabled?: boolean;
    headLines?: number;
    tailLines?: number;
}
interface PluginConfig {
    enabled?: boolean;
    gitDiff?: GitDiffConfig;
    gitLog?: GitLogConfig;
    grep?: GrepConfig;
    ls?: LsConfig;
    build?: BuildConfig;
}
declare const MARKER: (n: number) => string;
/** git diff: head + tail additions, preserve original when everything fits */
declare function truncateGitDiff(text: string, head: number, tail: number): string;
/** git log: one line per commit — hash | subject */
declare function truncateGitLog(text: string, max: number): string;
/** grep: strip absolute paths, keep filename:line:col */
declare function truncateGrep(text: string, max: number): string;
/** ls: strip perms/owner/group/time, abbreviate size */
declare function truncateLs(text: string, max: number): string;
/** build output: strip ANSI, progress bars, keep errors/warnings */
declare function truncateBuild(text: string, head: number, tail: number): string;
declare function applyTruncation(output: string, domain: string, config: PluginConfig): string;
declare function detectDomain(text: string): string | null;
export { truncateGitDiff, truncateGitLog, truncateGrep, truncateLs, truncateBuild, detectDomain, applyTruncation, MARKER, };
declare const _default: any;
export default _default;
