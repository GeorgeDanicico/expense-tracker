"use client";

import { Card } from "@/components/ui/card";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function MyPermissionsPage() {
  useDocumentTitle("My permissions");
  return (
    <Card>
      <Card.Header title="My permissions" description="What you can use in the app will show up here." />
    </Card>
  );
}
