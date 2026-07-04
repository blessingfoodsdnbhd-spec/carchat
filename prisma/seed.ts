// Seed demo data — merchants, services, showcase cars, shop listings.
// Mirrors the mock data in the app so the backend feels populated on day one.
import "dotenv/config";
import { prisma } from "../src/db.js";

async function main() {
  // a demo user who owns the merchants (so biz dashboard has data)
  const owner = await prisma.user.upsert({
    where: { email: "owner@carchat.my" },
    update: {},
    create: { email: "owner@carchat.my", name: "carchat merchant", provider: "google" },
  });

  const merchants = [
    { name: "Speedy Wash KL", category: "wash", lat: 3.0805, lng: 101.5855, rating: 4.8, reviewCount: 213, isOpen: true },
    { name: "Glow Auto Spa", category: "wash", lat: 3.0772, lng: 101.5925, rating: 4.7, reviewCount: 142, isOpen: true },
    { name: "AutoCare Bengkel SS15", category: "service", lat: 3.0738, lng: 101.585, rating: 4.9, reviewCount: 521, isOpen: true },
    { name: "KL Master Service", category: "service", lat: 3.069, lng: 101.5788, rating: 4.5, reviewCount: 309, isOpen: true },
    { name: "Tayar Pro Cheras", category: "tyres", lat: 3.0852, lng: 101.5808, rating: 4.6, reviewCount: 88, isOpen: false },
  ];

  for (const m of merchants) {
    const existing = await prisma.merchant.findFirst({ where: { name: m.name } });
    if (existing) continue;
    const created = await prisma.merchant.create({ data: { ...m, ownerUserId: owner.id } });
    await prisma.service.createMany({
      data: [
        { merchantId: created.id, name: "Premium wash + vacuum", price: 45, duration: "45 min" },
        { merchantId: created.id, name: "Engine oil service", price: 180, duration: "1 hr" },
        { merchantId: created.id, name: "Tyre rotation + balance", price: 60, duration: "40 min" },
      ],
    });
  }

  // showcase cars
  const cars = [
    { owner: "Faiz Hakimi", tag: "JDM", caption: "Honda Civic Type R FK8", likeCount: 342 },
    { owner: "Mei Ling", tag: "Legend", caption: "Mazda RX-7 FD3S", likeCount: 521 },
    { owner: "Daniel Tan", tag: "Retro", caption: "Toyota AE86 Trueno", likeCount: 410 },
  ];
  for (const c of cars) {
    const u = await prisma.user.upsert({
      where: { email: `${c.owner.replace(/\s/g, "").toLowerCase()}@example.com` },
      update: {},
      create: { email: `${c.owner.replace(/\s/g, "").toLowerCase()}@example.com`, name: c.owner, provider: "google" },
    });
    const exists = await prisma.showcase.findFirst({ where: { userId: u.id } });
    if (!exists) await prisma.showcase.create({ data: { userId: u.id, tag: c.tag, caption: c.caption, likeCount: c.likeCount } });
  }

  // shop listings
  const seller = await prisma.user.upsert({
    where: { email: "mart@carchat.my" },
    update: {},
    create: { email: "mart@carchat.my", name: "carchat Mart", provider: "google" },
  });
  const listings = [
    { category: "care", title: "Meguiar's Gold Class Shampoo", price: 49 },
    { category: "voucher", title: "Premium Wash + Wax voucher", price: 39 },
    { category: "access", title: "Microfibre towel set (6 pcs)", price: 29 },
    { category: "parts", title: "Bosch wiper blades (pair)", price: 59 },
  ];
  for (const l of listings) {
    const exists = await prisma.listing.findFirst({ where: { title: l.title } });
    if (!exists) await prisma.listing.create({ data: { ...l, sellerUserId: seller.id } });
  }

  console.log("Seed complete.");
}

main().finally(() => prisma.$disconnect());
