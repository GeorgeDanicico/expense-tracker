import { Box, Container, Heading, Stack, Table, Text } from "@chakra-ui/react";
import type { Metadata } from "next";
import NextLink from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui";

import { MOCKUPS, mockupHref } from "./mockups";

export const metadata: Metadata = { title: "U3 mockups" };

/** Development-only: the list of U3's mockups and their tap counts. */
export default function MockupsIndexPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Container maxW="1100px" px={{ base: "4", md: "6" }} py={{ base: "5", md: "8" }}>
      <Stack gap="5">
        <Stack gap="1">
          <Heading as="h1" size="xl">
            U3 mockups
          </Heading>
          <Text textStyle="bodySm" color="fg.muted">
            Phone first, responsive at 1280 px, fixtures only. The direction is in docs/ui-direction.md; the Motion section is in{" "}
            <NextLink href="/dev/ui#motion">/dev/ui</NextLink>. Taps are counted from Home on a phone.
          </Text>
        </Stack>
        <Card>
          <Box overflowX="auto">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Mockup</Table.ColumnHeader>
                  <Table.ColumnHeader>Task</Table.ColumnHeader>
                  <Table.ColumnHeader>Today</Table.ColumnHeader>
                  <Table.ColumnHeader>Mockup</Table.ColumnHeader>
                  <Table.ColumnHeader>Target</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {MOCKUPS.flatMap((mockup) =>
                  mockup.taps.map((tap, index) => (
                    <Table.Row key={`${mockup.id}-${tap.task}`}>
                      <Table.Cell fontWeight="medium">{index === 0 ? <NextLink href={mockupHref(mockup.id)}>{mockup.title}</NextLink> : null}</Table.Cell>
                      <Table.Cell>{tap.task}</Table.Cell>
                      <Table.Cell color="fg.muted">{tap.today}</Table.Cell>
                      <Table.Cell>{tap.here}</Table.Cell>
                      <Table.Cell color="fg.muted">{"target" in tap ? tap.target : "—"}</Table.Cell>
                    </Table.Row>
                  )),
                )}
              </Table.Body>
            </Table.Root>
          </Box>
        </Card>
      </Stack>
    </Container>
  );
}
