import { execFile } from 'child_process';
import { isAbsolute } from 'path';
import { HttpResponse } from '../models/httpResponse';
import { isJSONString, removeHeader } from './misc';

export async function transformResponseWithJq(response: HttpResponse, filterPath: string, jqPath = ''): Promise<HttpResponse> {
    if (jqPath !== '' && (typeof jqPath !== 'string' || !isAbsolute(jqPath))) {
        throw new Error('Set rest-client-ng.jqPath to an absolute path to the jq executable.');
    }

    const body = await new Promise<string>((resolve, reject) => {
        const jq = execFile(jqPath || 'jq', ['-M', '-f', filterPath], {
            timeout: 10_000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    reject(new Error(jqPath
                        ? `jq was not found at "${jqPath}". Check rest-client-ng.jqPath.`
                        : 'Install jq and add it to the extension host PATH or set rest-client-ng.jqPath.'));
                    return;
                }
                const detail = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'jq exceeded the 10 MiB output limit.'
                    : error.killed ? 'jq exceeded the 10-second time limit.'
                    : stderr.trim().slice(0, 500) || error.message;
                reject(new Error(detail));
            } else {
                resolve(stdout);
            }
        });
        jq.stdin?.on('error', (error: NodeJS.ErrnoException) => {
            // jq can exit before consuming stdin, in which case its exit status carries the result.
            if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
                reject(error);
            }
        });
        jq.stdin?.end(response.body, 'utf8');
    });

    const headers = { ...response.headers };
    for (const name of ['Content-Type', 'Content-Length', 'Content-Encoding', 'Content-Disposition', 'Transfer-Encoding']) {
        removeHeader(headers, name);
    }
    const buffer = Buffer.from(body, 'utf8');
    headers['Content-Type'] = isJSONString(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
    headers['Content-Length'] = String(buffer.length);
    return new HttpResponse(response.statusCode, response.statusMessage, response.httpVersion,
        headers, body, buffer.length, response.headersSizeInBytes, buffer, response.timingPhases, response.request);
}
