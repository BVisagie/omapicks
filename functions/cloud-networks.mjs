// Autonomous system numbers of large cloud and hosting providers. Most scripted traffic that
// imitates a browser runs here, so page views from these networks are counted separately
// instead of as people. Cloudflare (WARP) and consumer VPN networks such as M247, Datacamp
// and Mullvad are deliberately absent: people browse through them.
export const CLOUD_NETWORK_ASNS = new Map([
  [16509, "Amazon AWS"],
  [14618, "Amazon AWS"],
  [15169, "Google"],
  [396982, "Google Cloud"],
  [8075, "Microsoft Azure"],
  [14061, "DigitalOcean"],
  [24940, "Hetzner"],
  [16276, "OVHcloud"],
  [63949, "Akamai Linode"],
  [31898, "Oracle Cloud"],
  [45102, "Alibaba Cloud"],
  [132203, "Tencent Cloud"],
  [136907, "Huawei Cloud"],
  [20473, "Vultr"],
  [51167, "Contabo"],
  [12876, "Scaleway"]
]);

export function isCloudNetwork(asn) {
  return CLOUD_NETWORK_ASNS.has(Number(asn));
}
