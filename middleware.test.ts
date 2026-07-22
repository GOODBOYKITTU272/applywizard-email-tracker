import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("middleware", () => {
  it("no longer issues a Basic Auth challenge for protected paths", () => {
    const request = new NextRequest("https://email-apply-wizz.test/overview");
    const response = middleware(request);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });
});
