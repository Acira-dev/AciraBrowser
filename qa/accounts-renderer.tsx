import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import { Onboarding } from "../src/features/onboarding/Onboarding";
import { createSetupClient } from "../src/services/accounts/setup-client";
import type {
  SetupRequest,
  SetupResult,
} from "../src/services/accounts/setup-types";
declare global {
  interface Window {
    localSetupQa: { setup: (request: SetupRequest) => Promise<SetupResult> };
  }
}
const client = createSetupClient(window.localSetupQa);
function Fixture() {
  const [done, setDone] = useState(false);
  const [profileId, setProfileId] = useState("local-a");
  const onDone = useCallback(() => setDone(true), []);
  useEffect(() => {
    const changeProfile = (event: Event) =>
      setProfileId((event as CustomEvent<string>).detail);
    window.addEventListener("local-setup-qa-profile", changeProfile);
    return () =>
      window.removeEventListener("local-setup-qa-profile", changeProfile);
  }, []);
  return done ? (
    <h1>Local browsing remains available</h1>
  ) : (
    <Onboarding client={client} profileId={profileId} onDone={onDone} />
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
