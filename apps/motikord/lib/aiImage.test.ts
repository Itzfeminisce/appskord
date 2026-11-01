import { describe, expect, it, vi } from 'vitest';
import { ImageError, limitWords, makeImage, saveImage, stateForStatus, wordCount } from './aiImage';

const png = btoa('png-bytes');
const ok = () => new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 });
const fail = async (f: () => Promise<Response>) => makeImage('a red kettle', '9:16', { fetch: f, key: 'sk-test' }).catch((e: unknown) => (e as ImageError).state);

describe('makeImage', () => {
  it('sends one request with only the description and the bearer key', async () => {
    const fetch = vi.fn(async () => ok());
    const img = await makeImage('a red kettle on a table', '1:1', { fetch, key: 'sk-test' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toMatchObject({ prompt: 'a red kettle on a table', n: 1, size: '1024x1024' });
    expect(img.blob.size).toBeGreaterThan(0);
    expect(img.width).toBe(1024);
  });
  it('cuts the description to 12 words', async () => {
    const fetch = vi.fn(async () => ok());
    await makeImage('one two three four five six seven eight nine ten eleven twelve thirteen', '16:9', { fetch, key: 'sk-test' });
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).prompt).toBe('one two three four five six seven eight nine ten eleven twelve');
    expect(wordCount(limitWords('a b c d e f g h i j k l m n'))).toBe(12);
  });
  it('maps each failure to its state', async () => {
    expect(await fail(async () => new Response('', { status: 401 }))).toBe('image-key-rejected');
    expect(await fail(async () => new Response('', { status: 403 }))).toBe('image-key-rejected');
    expect(await fail(async () => new Response('', { status: 400 }))).toBe('image-refused');
    expect(await fail(async () => new Response('', { status: 429 }))).toBe('image-quota');
    expect(await fail(async () => new Response('', { status: 503 }))).toBe('image-offline');
    expect(await fail(async () => { throw new TypeError('network'); })).toBe('image-offline');
    expect(await fail(async () => new Response('{"data":[]}', { status: 200 }))).toBe('image-refused');
    expect(stateForStatus(500)).toBe('image-offline');
  });
  it('says the key is missing without any request', async () => {
    const fetch = vi.fn(async () => ok());
    vi.stubGlobal('browser', { storage: { session: { get: async () => ({}) } } });
    await expect(makeImage('kettle', '9:16', { fetch })).rejects.toMatchObject({ state: 'image-key-missing' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('saveImage', () => {
  it('keeps the file locally with the AI credit', async () => {
    const put = vi.fn(async () => undefined);
    const asset = await saveImage({ blob: new Blob(['x'], { type: 'image/png' }), width: 1024, height: 1536, description: 'a red kettle' }, { put, id: 'a1' });
    expect(put).toHaveBeenCalledWith('media/a1.png', expect.any(Blob));
    expect(asset.credit).toMatchObject({ author: 'OpenAI', source: 'ai', licence: 'ai', url: '' });
  });
});
