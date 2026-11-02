"use client";

import { Button } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { downloadMyData } from "@/lib/api/account-requests";

/** Saves `blob` as a file called `fileName`, the way a download link would. */
function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Settings → Account: downloads a ZIP of everything the account holds (`POST /api/account/export`). */
export function DownloadDataCard() {
  const form = useApiForm();
  const [saved, setSaved] = useState(false);

  function download() {
    setSaved(false);
    void form.submit(async () => {
      const { blob, fileName } = await downloadMyData();
      saveFile(blob, fileName);
      setSaved(true);
    }, { fallback: "Unable to download your data. Please try again." });
  }

  return (
    <Card>
      <Card.Header
        title="Download my data"
        description="Get a copy of everything in your account: your profile, expenses, investments, net worth, reminders, statement imports and more. It comes as a ZIP file with a spreadsheet (CSV) and a JSON file for each part."
      />
      {form.error || saved ? (
        <Card.Body>
          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          {saved ? <InlineAlert status="success">Your data was downloaded. Look for it in your downloads.</InlineAlert> : null}
        </Card.Body>
      ) : null}
      <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
        <Button variant="outline" onClick={download} loading={form.pending} loadingText="Preparing…">
          <Download size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Download my data
        </Button>
      </Card.Footer>
    </Card>
  );
}
