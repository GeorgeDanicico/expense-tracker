import { Box, ChakraProvider } from "@chakra-ui/react";
import { use, type ReactNode } from "react";
import { Writable } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StreamedSection } from "@/components/ui/streamed-section";
import { ledgerSystem } from "@/components/ui/theme";

/** A block that waits for `data`, like a Home block reading the server's promise. */
function Waiting({ data }: { data: Promise<string> }) {
  return <Box padding="3" borderRadius="md">{use(data)}</Box>;
}

/**
 * The HTML of `tree` rendered on the server, streamed as a page is: the shell is ready with the
 * section's fallback, and only then does `release` let the data arrive.
 */
function serverHtml(tree: ReactNode, release: () => void) {
  return new Promise<string>((resolve, reject) => {
    let html = "";
    const sink = new Writable({
      write(chunk, _encoding, done) {
        html += String(chunk);
        done();
      },
      final(done) {
        resolve(html);
        done();
      },
    });
    // A whole document: React streams a boundary that waits only inside one.
    const { pipe } = renderToPipeableStream(<html><body><ChakraProvider value={ledgerSystem}>{tree}</ChakraProvider></body></html>, {
      // The shell is out, with the section's fallback in it: now the data may arrive.
      onShellReady() {
        pipe(sink);
        setTimeout(release, 20);
      },
      onShellError: reject,
    });
  });
}

/** The classes used inside the streamed segment, and the ones it defines in its own `<style>` tags. */
function segment(html: string) {
  const body = html.match(/<div hidden id="S:0">([\s\S]*?)<\/div><script/)?.[1] ?? "";
  const used = [...body.matchAll(/class="([^"]+)"/g)].flatMap(([, names]) => names.split(" ")).filter((name) => name.startsWith("css-"));
  const defined = [...body.matchAll(/<style data-emotion="css ([^"]+)"/g)].flatMap(([, names]) => names.split(" ")).map((name) => `css-${name}`);
  return { used, defined };
}

describe("StreamedSection", () => {
  it("streams content that carries every style it uses, even one its loading card wrote first", async () => {
    let resolve: (value: string) => void = () => undefined;
    const data = new Promise<string>((done) => { resolve = done; });

    // An outer Chakra element, as the app shell is: on the server it holds the one style cache below it.
    const html = await serverHtml(
      <Box>
        <StreamedSection fallback={<Box padding="3" borderRadius="md">Loading…</Box>}>
          <Waiting data={data} />
        </StreamedSection>
      </Box>,
      () => resolve("The data"),
    );

    const { used, defined } = segment(html);
    expect(html.indexOf("Loading…")).toBeLessThan(html.indexOf("The data"));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.includes(name))).toEqual([]);
  });
});
