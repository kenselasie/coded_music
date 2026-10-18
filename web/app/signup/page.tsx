"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Description,
  Heading,
  Inline,
  SectionMessage,
  Stack,
  TextField,
} from "@kenselasie/codeddesign";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { FormEvent, useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not create account.");
        return;
      }
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Account created — sign in from the login page.");
        router.push("/login");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not create account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="l">
      <Heading size="xxl" withoutMargins>
        CodedMusic
      </Heading>
      <Card>
        <CardHeader>
          <CardTitle>Create account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <Stack gap="m">
              <Description>Save songs and stem jobs under your account.</Description>
              {error ? (
                <SectionMessage variant="danger" title="Could not create account">
                  {error}
                </SectionMessage>
              ) : null}
              <TextField
                label="Name"
                autoComplete="name"
                value={name}
                onChange={setName}
              />
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                required
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                required
              />
              <Inline gap="s">
                <Button type="submit" variant="primary" isPending={busy}>
                  {busy ? "Creating…" : "Create account"}
                </Button>
                <Link href="/login">Sign in</Link>
              </Inline>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Stack>
  );
}
