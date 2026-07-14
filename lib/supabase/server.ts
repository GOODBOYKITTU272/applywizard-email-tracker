import "server-only";

import { createSupabaseServiceRoleClient } from "./serviceRole";

export function createSupabaseServerClient() {
  return createSupabaseServiceRoleClient();
}
