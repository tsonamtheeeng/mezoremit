"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { z } from "zod";
import { errorMessage } from "@/lib/client/api";
import { loadShowNamePref, saveShowNamePref } from "@/lib/client/send";
import { useAuth } from "@/hooks/use-auth";
import { useUpdateSettings } from "@/hooks/use-api";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AuthGate } from "@/components/wallet/auth-gate";
import { AddressText } from "@/components/shared/address";
import { PageHeader } from "@/components/shared/states";

const emailSchema = z.union([z.literal(""), z.email("Enter a valid email address.")]);

function Section({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t py-6 first:border-t-0 first:pt-0 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {body ? <p className="mt-1 text-[0.8125rem] text-muted-foreground">{body}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Body() {
  const mounted = useMounted();
  const auth = useAuth();
  const update = useUpdateSettings();
  const { resolvedTheme, setTheme } = useTheme();
  // Body only renders client-side for a signed-in user (AuthGate), so initial values can come from the session and storage.
  const [name, setName] = useState(() => auth.user?.displayName ?? "");
  const [email, setEmail] = useState(() => auth.user?.email ?? "");
  const [emailOn, setEmailOn] = useState(() => auth.user?.emailNotifications ?? false);
  const [showName, setShowName] = useState(() => loadShowNamePref());
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});

  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const em = email.trim();
    const errs: typeof errors = {};
    if (n.length > 40) errs.name = "Keep it under 40 characters.";
    if (!emailSchema.safeParse(em).success) errs.email = "Enter a valid email address.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    update.mutate(
      { displayName: n || null, email: em || null, emailNotifications: em ? emailOn : false },
      {
        onSuccess: () => toast.success("Saved"),
        onError: (err) => toast.error("Couldn't save", { description: errorMessage(err) }),
      },
    );
  }

  function toggleEmail(v: boolean) {
    setEmailOn(v);
    update.mutate(
      { emailNotifications: v },
      {
        onSuccess: () => toast.success(v ? "Email updates on" : "Email updates off"),
        onError: (err) => {
          setEmailOn(!v);
          toast.error("Couldn't change that", { description: errorMessage(err) });
        },
      },
    );
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-3xl">
        <Section title="Profile" body="Your name is only shown to recipients when you choose to.">
          <form noValidate onSubmit={saveProfile} className="space-y-4">
            <div>
              <Label htmlFor="s-name">Display name</Label>
              <Input id="s-name" className="mt-1.5" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby="s-name-e" />
              {errors.name ? <p id="s-name-e" role="alert" className="mt-1.5 text-[0.8125rem] text-bad">{errors.name}</p> : null}
            </div>
            <div>
              <Label htmlFor="s-email">Email (optional)</Label>
              <Input id="s-email" type="email" autoComplete="email" className="mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby="s-email-h s-email-e" />
              <p id="s-email-h" className="mt-1.5 text-[0.8125rem] text-muted-foreground">Only used for transfer updates. Never shown to anyone.</p>
              {errors.email ? <p id="s-email-e" role="alert" className="mt-1.5 text-[0.8125rem] text-bad">{errors.email}</p> : null}
            </div>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </Section>

        <Section title="Notifications" body="You always get updates in the app.">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Email me when a transfer changes</span>
              <span className="block text-[0.8125rem] text-muted-foreground">
                {auth.user?.email ? `Sent to ${auth.user.email}.` : "Add an email above first."}
              </span>
            </span>
            <Switch checked={emailOn} disabled={!auth.user?.email || update.isPending} onCheckedChange={toggleEmail} aria-label="Email me when a transfer changes" />
          </label>
        </Section>

        <Section title="Privacy" body="Applies to new transfers. You can change it per transfer too.">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Show my name on claim pages by default</span>
              <span className="block text-[0.8125rem] text-muted-foreground">Otherwise recipients only see that someone sent them money.</span>
            </span>
            <Switch
              checked={showName}
              onCheckedChange={(v) => {
                setShowName(v);
                saveShowNamePref(v);
              }}
              aria-label="Show my name on claim pages by default"
            />
          </label>
        </Section>

        <Section title="Appearance">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">Dark theme</span>
            <Switch checked={mounted && resolvedTheme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} aria-label="Dark theme" />
          </label>
        </Section>

        <Section title="Wallet">
          <p className="text-sm">
            Signed in as <AddressText address={auth.wallet.address} />
          </p>
          <Button variant="outline" onClick={() => auth.signOut.mutate()} disabled={auth.signOut.isPending}>
            Sign out
          </Button>
        </Section>
      </div>
    </>
  );
}

export function SettingsView() {
  return (
    <AuthGate title="Sign in to change settings">
      <Body />
    </AuthGate>
  );
}
