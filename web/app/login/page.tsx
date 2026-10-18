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
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { FormEvent, Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid email or password.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit}>
          <Stack gap="m">
            <Description>Your library and jobs stay on your account.</Description>
            {error ? (
              <SectionMessage variant="danger" title="Sign in failed">
                {error}
              </SectionMessage>
            ) : null}
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
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
            />
            <Inline gap="s">
              <Button type="submit" variant="primary" isPending={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <Link href="/signup">Create account</Link>
            </Inline>
          </Stack>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Stack gap="l">
      <Heading size="xxl" withoutMargins>
        CodedMusic
      </Heading>
      <Suspense fallback={<Description>Loading…</Description>}>
        <LoginForm />
      </Suspense>
    </Stack>
  );
}
