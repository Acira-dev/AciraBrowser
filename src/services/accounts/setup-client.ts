import type { SetupClient, SetupRequest, SetupResult } from "./setup-types";
import { t } from '../../i18n';
export function createSetupClient(bridge?: {
  setup?: (request: SetupRequest) => Promise<SetupResult>;
}): SetupClient {
  return {
    async request(request) {
      if (!bridge?.setup)
        return {
          ok: false,
          error: {
            code: "DESKTOP_REQUIRED",
            message: t("setupClient.openAciraDesktopToChange"),
          },
        };
      return bridge.setup(request);
    },
  };
}
export type { SetupClient, SetupRequest, SetupResult };
