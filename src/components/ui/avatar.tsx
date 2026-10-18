"use client";

import { Avatar as ChakraAvatar } from "@chakra-ui/react";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

/** Our sizes on Chakra's avatar recipe: xs 24px, sm 32px, md 40px, lg 64px (the recipe scales the initials). */
const RECIPE_SIZE = { xs: "2xs", sm: "xs", md: "md", lg: "2xl" } as const satisfies Record<AvatarSize, string>;

/**
 * A person's picture, or their initials on their member colour when they have none (or it fails to
 * load). `name` is required even with a picture: it's the image's alt text and the fallback.
 * `color` is a member colour token (`member.3`, from `useMemberColors()`); the initials use its
 * paired `member.<n>.fg` token. Without one, or with a colour that isn't a palette slot (members past
 * the eighth share `fg.subtle`, which has no paired text colour), the fallback is neutral.
 * `decorative` hides it from screen readers, for places where the name is already written beside it
 * (the sidebar's account row), so the name isn't read twice.
 */
export function Avatar({
  name,
  src,
  color,
  size = "sm",
  decorative = false,
}: {
  name: string;
  src?: string | null;
  color?: string;
  size?: AvatarSize;
  decorative?: boolean;
}) {
  const slot = color && /^member\.[1-8]$/.test(color) ? color : null;
  return (
    <ChakraAvatar.Root
      size={RECIPE_SIZE[size]}
      shape="full"
      bg={slot ?? "bg.muted"}
      color={slot ? `${slot}.fg` : "fg.muted"}
      aria-hidden={decorative || undefined}
    >
      {decorative ? (
        <ChakraAvatar.Fallback name={name} />
      ) : (
        <ChakraAvatar.Fallback name={name} role="img" aria-label={name} />
      )}
      {src ? <ChakraAvatar.Image src={src} alt={decorative ? "" : name} /> : null}
    </ChakraAvatar.Root>
  );
}
