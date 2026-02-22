export const getApiBaseUrl = (
  _fastapi: boolean = false,
  _betterauth: boolean = false
): string => {
  if (typeof window !== "undefined") {
    return "http://127.0.0.1:8000";
  }
  return process.env.VIDERE_RENDER_SERVER_URL || "http://127.0.0.1:8000";
};

export const apiUrl = (
  endpoint: string,
  fastapi: boolean = false,
  betterauth: boolean = false
): string => {
  const baseUrl = getApiBaseUrl(fastapi, betterauth);
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return path ? `${baseUrl}${path}` : `${baseUrl}`;
};
