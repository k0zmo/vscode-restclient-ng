import { execFile } from 'child_process';
import { HttpResponse } from '../models/httpResponse';
import { isJSONString, removeHeader } from './misc';

export async function transformResponseWithJq(response: HttpResponse, filterPath: string): Promise<HttpResponse> {
    const body = await new Promise<string>((resolve, reject) => {
        const jq = execFile('jq', ['-M', '-f', filterPath], {
            timeout: 10_000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error) {
                const detail = error.code === 'ENOENT' ? 'Install jq and add it to the extension host PATH.'
                    : error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'jq exceeded the 10 MiB output limit.'
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
