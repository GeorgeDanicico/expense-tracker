"use client";

import { Box, Button, chakra, Flex, Grid, Stack, Switch, Text } from "@chakra-ui/react";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  KeyRound,
  LogOut,
  Mail,
  Palette,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserPlus,
  UserRound,
  UserRoundX,
  Users,
  type LucideIcon,
} from "lucide-react";
import NextLink from "next/link";
import type { ReactNode } from "react";

import { Avatar, Card, ICON, InlineAlert } from "@/components/ui";

import { useMockState } from "../mock-state";
import { MOCK_ME, MOCK_MEMBERS } from "../mockup-data";
import { mockupHref, type MockupId } from "../mockups";
import { GroupLabel, PageTitle } from "../mockup-parts";
import { PROPOSED_SPACING, radius, transition } from "../proposed-theme";
import { IconTile, MockRow, RowActions } from "../stand-ins";

type Page = "account" | "notifications" | "family";
/** `page` marks the entries that are a settings page, so the open one is highlighted on desktop. */
type ListEntry = { label: string; icon: LucideIcon; value?: string; href?: MockupId; page?: Page; tone?: "danger"; onSelect?: () => void };

/** One grouped list instead of seven tabs. Parent-only rows (Invite, Add a kid) only for parents. */
function settingsGroups(showToast: (message: string) => void): { label?: string; entries: ListEntry[] }[] {
  const soon = (label: string) => () => showToast(`${label} isn't mocked in U3`);
  return [
    {
      label: "Settings",
      entries: [
        { label: "Account", icon: UserRound, value: "EUR", href: "settings-account", page: "account" },
        { label: "Notifications", icon: Bell, value: "On", href: "settings-notifications", page: "notifications" },
        { label: "Family", icon: Users, value: "4 members", href: "settings-family", page: "family" },
        { label: "AI", icon: Sparkles, value: "Assistants, features", onSelect: soon("AI") },
      ],
    },
    {
      label: "Family",
      entries: [
        { label: "Invite someone", icon: UserPlus, href: "settings-family" },
        { label: "Add a kid", icon: ShieldCheck, href: "settings-family" },
      ],
    },
    { label: "This phone", entries: [{ label: "Install iFam", icon: Smartphone, onSelect: soon("Install") }] },
    { entries: [{ label: "Sign out", icon: LogOut, tone: "danger", onSelect: soon("Sign out") }] },
  ];
}

/** A rounded list of rows; each opens its page (or does its one thing). */
function GroupedList({ entries, active }: { entries: ListEntry[]; active?: Page }) {
  return (
    <Box as="ul" listStyleType="none" m="0" p="0" bg="bg.surface" borderRadius={radius("card")} overflow="hidden" boxShadow="xs">
      {entries.map((entry, index) => {
        // Highlighted on desktop only: on a phone the list is More, and no page is open.
        const current = Boolean(active && entry.page === active);
        const selected = current ? { md: "bg.selected" } : undefined;
        const row = (
          <Flex
            align="center"
            gap="3"
            minH={PROPOSED_SPACING.rowMinH}
            px="3.5"
            borderTopWidth={index === 0 ? "0" : "1px"}
            borderColor="border"
            bg={selected}
            transition={transition("background-color", "fast")}
            _hover={{ bg: current ? selected : "bg.subtle" }}
            _active={{ bg: "bg.muted" }}
            color={entry.tone === "danger" ? "fg.error" : undefined}
          >
            {entry.tone ? null : <IconTile icon={entry.icon} bg="bg.muted" color={current ? { base: "fg.muted", md: "fg.accent" } : "fg.muted"} />}
            <Text as="span" flex="1" textStyle="body" fontWeight="medium">
              {entry.label}
            </Text>
            {entry.value ? (
              <Text as="span" textStyle="bodySm" color="fg.subtle" truncate maxW="45%">
                {entry.value}
              </Text>
            ) : null}
            {entry.href ? <ChevronRight size={ICON.sm} aria-hidden="true" /> : null}
          </Flex>
        );
        return (
          <Box as="li" key={entry.label}>
            {entry.href ? (
              <NextLink href={mockupHref(entry.href)} aria-current={current ? "page" : undefined}>
                {row}
              </NextLink>
            ) : (
              <chakra.button type="button" width="full" textAlign="start" data-pressable onClick={entry.onSelect}>
                {row}
              </chakra.button>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function SettingsList({ active }: { active?: Page }) {
  const { showToast } = useMockState();
  return (
    <Stack gap="4">
      {settingsGroups((message) => showToast({ message })).map((group, index) => (
        <Stack key={group.label ?? index} gap="1.5">
          {group.label ? <GroupLabel px="1">{group.label}</GroupLabel> : null}
          <GroupedList entries={group.entries} active={active} />
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * Phone: More is the list, and each settings page is its own screen with a way back. Desktop: the
 * list sits on the left and the page on the right. `listOnPhone` is More itself.
 */
function SettingsLayout({ page, title, listOnPhone = false, children }: { page: Page; title: string; listOnPhone?: boolean; children: ReactNode }) {
  return (
    <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "16rem minmax(0, 1fr)", lg: "19rem minmax(0, 1fr)" }} gap={PROPOSED_SPACING.columnGap} alignItems="start">
      <Stack gap={PROPOSED_SPACING.sectionGap} display={{ base: listOnPhone ? "flex" : "none", md: "flex" }}>
        <PageTitle title={listOnPhone ? "More" : "Settings"} />
        {listOnPhone ? <ProfileCard /> : null}
        <SettingsList active={page} />
      </Stack>
      <Stack gap={PROPOSED_SPACING.sectionGap} display={{ base: listOnPhone ? "none" : "flex", md: "flex" }} maxW="44rem">
        <Box display={{ md: "none" }}>
          <NextLink href={mockupHref("more")}>
            <Flex align="center" gap="1" color="fg.accent" textStyle="body" fontWeight="medium" minH="11">
              <ChevronLeft size={ICON.nav} aria-hidden="true" /> More
            </Flex>
          </NextLink>
        </Box>
        <PageTitle title={title} />
        {children}
      </Stack>
    </Grid>
  );
}

function ProfileCard() {
  return (
    <Card>
      <Card.Body>
        <Flex align="center" gap="3">
          <Avatar name={MOCK_ME.fullName} color="member.1" size="md" />
          <Box minW="0">
            <Text textStyle="sectionTitle">{MOCK_ME.fullName}</Text>
            <Text textStyle="bodySm" color="fg.muted">
              Parent · {MOCK_ME.family}
            </Text>
          </Box>
        </Flex>
      </Card.Body>
    </Card>
  );
}

/** More on a phone; on desktop there's no More, so it shows Settings with Account open. */
export function MoreMockup() {
  return (
    <SettingsLayout page="account" title="Account" listOnPhone>
      <AccountPage />
    </SettingsLayout>
  );
}

export function SettingsMockup({ page }: { page: Page }) {
  const title = { account: "Account", notifications: "Notifications", family: "Family" }[page];
  const Content = { account: AccountPage, notifications: NotificationsPage, family: FamilyPage }[page];
  return (
    <SettingsLayout page={page} title={title}>
      <Content />
    </SettingsLayout>
  );
}

/** A card of rows with a chevron: the settings that open something. */
function RowsCard({ title, rows }: { title?: string; rows: { label: string; icon: LucideIcon; value?: string; hint?: string }[] }) {
  const { showToast } = useMockState();
  return (
    <Stack gap="1.5">
      {title ? <GroupLabel px="1">{title}</GroupLabel> : null}
      <Card>
        <Card.Body>
          <Stack gap="0.5" mx="-2">
            {rows.map((row) => (
              <chakra.button key={row.label} type="button" textAlign="start" data-pressable onClick={() => showToast({ message: `${row.label} isn't mocked in U3` })}>
                <MockRow
                  leading={<IconTile icon={row.icon} bg="bg.muted" color="fg.muted" />}
                  title={row.label}
                  meta={row.hint}
                  trailing={
                    <>
                      {row.value ? (
                        <Text as="span" textStyle="bodySm" color="fg.subtle">
                          {row.value}
                        </Text>
                      ) : null}
                      <ChevronRight size={ICON.sm} aria-hidden="true" />
                    </>
                  }
                />
              </chakra.button>
            ))}
          </Stack>
        </Card.Body>
      </Card>
    </Stack>
  );
}

function AccountPage() {
  return (
    <>
      <Card>
        <Card.Body>
          <Flex align="center" gap="4" wrap="wrap">
            <Avatar name={MOCK_ME.fullName} color="member.1" size="lg" />
            <Box flex="1" minW="10rem">
              <Text textStyle="sectionTitle">{MOCK_ME.fullName}</Text>
              <Text textStyle="bodySm" color="fg.muted">
                @{MOCK_ME.username} · {MOCK_ME.email}
              </Text>
            </Box>
            <Button variant="outline" size="md">
              Change picture
            </Button>
          </Flex>
        </Card.Body>
      </Card>
      <RowsCard
        title="Signing in"
        rows={[
          { label: "Change password", icon: KeyRound },
          { label: "Email", icon: Mail, value: MOCK_ME.email },
        ]}
      />
      <RowsCard title="Money" rows={[{ label: "Currency", icon: Coins, value: "EUR", hint: "Changing it doesn't convert past amounts." }]} />
      <RowsCard
        title="Your data"
        rows={[
          { label: "Download my data", icon: Download },
          { label: "Sign out everywhere", icon: LogOut, hint: "Every phone and browser signed in as you." },
        ]}
      />
      <Card>
        <Card.Header title="Delete my account" description="Removes your expenses, reminders and picture. You'll type your username to confirm." />
        <Card.Body>
          <Button variant="outline" colorPalette="danger" size="md">
            <UserRoundX size={ICON.sm} aria-hidden="true" /> Delete my account
          </Button>
        </Card.Body>
      </Card>
    </>
  );
}

function SwitchLine({ label, description, defaultChecked = true }: { label: string; description: string; defaultChecked?: boolean }) {
  return (
    <Switch.Root defaultChecked={defaultChecked} size="md" display="flex" justifyContent="space-between" alignItems="center" gap="4" width="full" minH={PROPOSED_SPACING.rowMinH}>
      <Box>
        <Switch.Label textStyle="body" fontWeight="medium">
          {label}
        </Switch.Label>
        <Text textStyle="bodySm" color="fg.muted">
          {description}
        </Text>
      </Box>
      <Switch.HiddenInput />
      <Switch.Control flexShrink="0" />
    </Switch.Root>
  );
}

function NotificationsPage() {
  const { showToast } = useMockState();
  return (
    <>
      <Card>
        <Card.Body>
          <Stack gap="3">
            <SwitchLine label="Notifications on this phone" description="Reminders, to-dos and events you choose below reach this phone." />
            <Button variant="outline" size="md" alignSelf="flex-start" onClick={() => showToast({ message: "Test sent: it arrives within half a minute" })}>
              Send a test
            </Button>
          </Stack>
        </Card.Body>
      </Card>
      <Stack gap="1.5">
        <GroupLabel px="1">What to send</GroupLabel>
        <Card>
          <Card.Body>
            <Stack gap="1">
              <SwitchLine label="Reminders" description="When one is due, and again if you snooze it." />
              <SwitchLine label="To-dos" description="When someone gives you a card." />
              <SwitchLine label="Calendar" description="An hour before events you're going to." defaultChecked={false} />
            </Stack>
          </Card.Body>
        </Card>
      </Stack>
      <InlineAlert status="info" title="Not getting them?">
        On an iPhone, add iFam to the Home Screen first. If the switch above is greyed out, notifications are blocked in the phone&apos;s settings.
      </InlineAlert>
    </>
  );
}

function FamilyPage() {
  const { showToast } = useMockState();
  const soon = (label: string) => () => showToast({ message: `${label} isn't mocked in U3` });
  return (
    <>
      <Card>
        <Card.Header
          title={MOCK_ME.family}
          description="4 members · you're a parent"
          actions={
            <Button variant="solid" colorPalette="brand" size="md" onClick={soon("Invite")}>
              <UserPlus size={ICON.sm} aria-hidden="true" /> Invite
            </Button>
          }
        />
        <Card.Body>
          <Stack gap="0.5" mx="-2">
            {MOCK_MEMBERS.map((member) => (
              <MockRow
                key={member.id}
                leading={<Avatar name={member.name} color={`member.${member.slot}`} size="md" />}
                title={member.id === "ana" ? `${member.name} (you)` : member.name}
                meta={`${member.role} · @${member.id}`}
                trailing={
                  member.id === "ana" ? null : (
                    <RowActions
                      label={member.name}
                      actions={[
                        { label: "Colour", icon: Palette, onSelect: soon("Colour") },
                        ...(member.role === "Kid"
                          ? [
                              { label: "Permissions", icon: ShieldCheck, onSelect: soon("Permissions") },
                              { label: "Reset password", icon: KeyRound, onSelect: soon("Reset password") },
                            ]
                          : []),
                        { label: "Remove from family", icon: UserRoundX, onSelect: soon("Remove"), tone: "danger" as const },
                      ]}
                    />
                  )
                }
              />
            ))}
          </Stack>
        </Card.Body>
      </Card>
      <Button variant="outline" size="md" alignSelf="flex-start" onClick={soon("Add a kid")}>
        <ShieldCheck size={ICON.sm} aria-hidden="true" /> Add a kid
      </Button>
      <Card>
        <Card.Header title="Pending invites" />
        <Card.Body>
          <Stack gap="0.5" mx="-2">
            <MockRow
              leading={<IconTile icon={Mail} bg="bg.muted" color="fg.muted" />}
              title="Invite link"
              meta="Expires in 6 days · not used yet"
              trailing={
                <Button variant="ghost" size="sm" onClick={soon("Copy")}>
                  Copy
                </Button>
              }
            />
          </Stack>
        </Card.Body>
      </Card>
    </>
  );
}
