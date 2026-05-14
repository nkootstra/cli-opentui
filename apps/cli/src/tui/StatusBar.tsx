import { useEffect, useMemo, useState } from "react";
import { readSession, type Session } from "@repo/skills/auth";

export type StatusBarDeps = {
  readSession?: () => Promise<Session | null>;
};

export function StatusBar({ deps = {} }: { deps?: StatusBarDeps }) {
  const [email, setEmail] = useState<string | null>(null);
  const getSession = useMemo(() => deps.readSession ?? readSession, [deps.readSession]);

  useEffect(() => {
    getSession()
      .then((session) => setEmail(session?.email ?? null))
      .catch(() => setEmail(null));
  }, [getSession]);

  if (!email) return <></>;

  return (
    <box flexDirection="row" flexShrink={0} flexGrow={0}>
      <text fg="#6ee7b7">{`Logged in as ${email}`}</text>
    </box>
  );
}
