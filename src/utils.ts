export function generateId(): string {
  const dt = new Date();
  const now =
    dt.getFullYear() +
    ("0" + (dt.getMonth() + 1)).slice(-2) +
    ("0" + dt.getDate()).slice(-2);
  const id = now + "-" + Math.floor(Math.random() * Math.floor(99999));
  return id;
}

export async function streamToString(stream: ReadableStream): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let done, value;

  while ({ done, value } = await reader.read(), !done) {
    chunks.push(value);
  }

  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

export async function stringToStream(str: string): Promise<ReadableStream> {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    }
  });
}