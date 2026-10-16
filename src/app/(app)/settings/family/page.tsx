"use client";

import { Card } from "@/components/ui/card";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function FamilySettingsPage() {
  useDocumentTitle("Family");
  return (
    <Card>
      <Card.Header title="Family" description="Your family and its members will show up here." />
    </Card>
  );
}
