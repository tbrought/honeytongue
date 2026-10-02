// The docs' release line, in the style of an Infocom banner: "Release <version> / Serial number <YYMMDD>", where the
// version links to its page on npm and the serial number is the date of that version's heading in CHANGELOG.md.
// npm run build:demo writes it into each page in STAMPED, and test/version.test.js fails if one is stale.
export const STAMPED = ["docs/index.html", "docs/play/index.html"];

/** The serial number for a version: its CHANGELOG heading's date as YYMMDD. */
export function serialNumber(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const date = changelog.match(new RegExp(`^## ${escaped} \\((\\d{2})(\\d{2})-(\\d{2})-(\\d{2})\\)`, "m"));
  if (!date) {
    throw new Error(`CHANGELOG.md has no heading for ${version}. Move the Unreleased entries under ` +
      `"## ${version} (YYYY-MM-DD)", with today's UTC date, then run npm run build:demo again.`);
  }
  return date.slice(2).join("");
}

/** A page with its release line set to this version and serial number. Each page has exactly one of each. */
export function stampRelease(html, version, serial, page = "the page") {
  const release = /Release (?:<a href="[^"]*">)?[0-9][^\s&<]*(?:<\/a>)?(?=&nbsp;\/| \/)/g;
  const number = /Serial number \d{6}/g;
  for (const [pattern, what] of [[release, "Release <version> /"], [number, "Serial number <YYMMDD>"]]) {
    const found = html.match(pattern)?.length ?? 0;
    if (found !== 1) throw new Error(`${page} should have one "${what}" in its credits, and has ${found}`);
  }
  const npm = `https://www.npmjs.com/package/honeytongue/v/${version}`;
  return html.replace(release, `Release <a href="${npm}">${version}</a>`).replace(number, `Serial number ${serial}`);
}
