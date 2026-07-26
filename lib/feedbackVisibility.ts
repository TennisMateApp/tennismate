export function shouldHideFloatingFeedback(pathname: string) {
  return /^\/clubs\/[^/]+(?:\/members)?\/?$/.test(pathname);
}
