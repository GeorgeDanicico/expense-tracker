import { Center } from "@chakra-ui/react";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getAuthenticatedUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect("/dashboard");

  return (
    <Center minH="100dvh" px="4" py="10">
      <AuthForm />
    </Center>
  );
}
