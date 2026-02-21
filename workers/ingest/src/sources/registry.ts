import type { SourceDefinition, SourcePolicy } from "@chainshorts/shared";

export interface SourceRegistryItem {
  source: SourceDefinition;
  policy: Omit<SourcePolicy, "id" | "sourceId" | "robotsCheckedAt">;
}

export const sourceRegistry: SourceRegistryItem[] = [
  // ── Tier 1: Major Web3 news outlets ──────────────────────────────────────
  {
    source: {
      id: "src_coindesk",
      name: "CoinDesk",
      homepageUrl: "https://www.coindesk.com",
      feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.coindesk.com/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_decrypt",
      name: "Decrypt",
      homepageUrl: "https://decrypt.co",
      feedUrl: "https://decrypt.co/feed",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://decrypt.co/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_cointelegraph",
      name: "Cointelegraph",
      homepageUrl: "https://cointelegraph.com",
      feedUrl: "https://cointelegraph.com/rss",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://cointelegraph.com/terms-and-conditions",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_theblock",
      name: "The Block",
      homepageUrl: "https://www.theblock.co",
      feedUrl: "https://www.theblock.co/rss.xml",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.theblock.co/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_thedefiant",
      name: "The Defiant",
      homepageUrl: "https://thedefiant.io",
      feedUrl: "https://thedefiant.io/feed",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://thedefiant.io/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 2: DeFi / protocol-focused ──────────────────────────────────────
  {
    source: {
      id: "src_ambcrypto",
      name: "AMB Crypto",
      homepageUrl: "https://ambcrypto.com",
      feedUrl: "https://ambcrypto.com/feed",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://ambcrypto.com/privacy-policy",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_bitcoinmag",
      name: "Bitcoin Magazine",
      homepageUrl: "https://bitcoinmagazine.com",
      feedUrl: "https://bitcoinmagazine.com/.rss/full/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://bitcoinmagazine.com/terms-of-service",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_beincrypto",
      name: "BeInCrypto",
      homepageUrl: "https://beincrypto.com",
      feedUrl: "https://beincrypto.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://beincrypto.com/terms-and-conditions/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_cryptoslate",
      name: "CryptoSlate",
      homepageUrl: "https://cryptoslate.com",
      feedUrl: "https://cryptoslate.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://cryptoslate.com/terms-and-conditions/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 3: Solana-specific ───────────────────────────────────────────────
  {
    source: {
      id: "src_solana_blog",
      name: "Solana Blog",
      homepageUrl: "https://solana.com/news",
      feedUrl: "https://solana.com/rss.xml",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://solana.com/terms-of-service",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_solanafloor",
      name: "Solana Floor",
      homepageUrl: "https://solanafloor.com",
      feedUrl: "https://solanafloor.com/feed",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://solanafloor.com/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: false,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 4: Regulation / security / macro ─────────────────────────────────
  {
    source: {
      id: "src_dlnews",
      name: "DL News",
      homepageUrl: "https://www.dlnews.com",
      feedUrl: "https://www.dlnews.com/rss/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.dlnews.com/terms-of-service/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 5: Additional Web3 Media ──────────────────────────────────────────
  {
    source: {
      id: "src_blockworks",
      name: "Blockworks",
      homepageUrl: "https://blockworks.co",
      feedUrl: "https://blockworks.co/feed",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://blockworks.co/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_coingape",
      name: "CoinGape",
      homepageUrl: "https://coingape.com",
      feedUrl: "https://coingape.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://coingape.com/privacy-policy",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_newsbtc",
      name: "NewsBTC",
      homepageUrl: "https://www.newsbtc.com",
      feedUrl: "https://www.newsbtc.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.newsbtc.com/terms-of-use/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_utoday",
      name: "U.Today",
      homepageUrl: "https://u.today",
      feedUrl: "https://u.today/rss",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://u.today/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_bitcoincom",
      name: "Bitcoin.com News",
      homepageUrl: "https://news.bitcoin.com",
      feedUrl: "https://news.bitcoin.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://bitcoin.com/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 6: Solana Ecosystem ─────────────────────────────────────────────────
  {
    source: {
      id: "src_helius_blog",
      name: "Helius Blog",
      homepageUrl: "https://www.helius.dev/blog",
      feedUrl: "https://www.helius.dev/blog/rss.xml",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.helius.dev/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 7: DeFi & Analytics ───────────────────────────────────────────────
  {
    source: {
      id: "src_defillama",
      name: "DeFi Llama",
      homepageUrl: "https://defillama.com",
      feedUrl: "https://defillama.com/blog/rss.xml",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://defillama.com/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 8: Security & Research ─────────────────────────────────────────────
  {
    source: {
      id: "src_rekt",
      name: "rekt.news",
      homepageUrl: "https://rekt.news",
      feedUrl: "https://rekt.news/rss.xml",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://rekt.news/about",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_chainalysis",
      name: "Chainalysis Blog",
      homepageUrl: "https://blog.chainalysis.com",
      feedUrl: "https://blog.chainalysis.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.chainalysis.com/terms-of-service/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 9: Additional Coverage ─────────────────────────────────────────────
  {
    source: {
      id: "src_cryptopotato",
      name: "CryptoPotato",
      homepageUrl: "https://cryptopotato.com",
      feedUrl: "https://cryptopotato.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://cryptopotato.com/terms-of-use/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_bitcoinist",
      name: "Bitcoinist",
      homepageUrl: "https://bitcoinist.com",
      feedUrl: "https://bitcoinist.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://bitcoinist.com/terms-of-use/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_cryptobriefing",
      name: "Crypto Briefing",
      homepageUrl: "https://cryptobriefing.com",
      feedUrl: "https://cryptobriefing.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://cryptobriefing.com/terms/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_dailyhodl",
      name: "The Daily Hodl",
      homepageUrl: "https://dailyhodl.com",
      feedUrl: "https://dailyhodl.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://dailyhodl.com/terms-of-use/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_cryptonews",
      name: "CryptoNews",
      homepageUrl: "https://cryptonews.com",
      feedUrl: "https://cryptonews.com/news/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://cryptonews.com/terms-and-conditions/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  // ── Tier 10: Additional Coverage (30+ sources total) ────────────────────────
  {
    source: {
      id: "src_watcherguru",
      name: "Watcher Guru",
      homepageUrl: "https://watcher.guru",
      feedUrl: "https://watcher.guru/news/feed",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://watcher.guru/terms",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_coinspeaker",
      name: "CoinSpeaker",
      homepageUrl: "https://www.coinspeaker.com",
      feedUrl: "https://www.coinspeaker.com/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.coinspeaker.com/terms-of-service/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_cryptoglobe",
      name: "CryptoGlobe",
      homepageUrl: "https://www.cryptoglobe.com",
      feedUrl: "https://www.cryptoglobe.com/latest/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://www.cryptoglobe.com/terms/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  },
  {
    source: {
      id: "src_coinpedia",
      name: "Coinpedia",
      homepageUrl: "https://coinpedia.org",
      feedUrl: "https://coinpedia.org/feed/",
      ingestType: "rss",
      languageHint: "en"
    },
    policy: {
      termsUrl: "https://coinpedia.org/terms-and-conditions/",
      allowsSummary: true,
      allowsHeadline: true,
      allowsImage: true,
      requiresLinkBack: true,
      ingestType: "rss",
      active: true
    }
  }
];

/**
 * Trusted sources — these have editorial standards, skip fact-check stage
 */
export const TRUSTED_SOURCE_IDS = new Set([
  "src_coindesk",
  "src_decrypt",
  "src_theblock",
  "src_thedefiant",
  "src_bitcoinmag",
  "src_solana_blog",
  "src_blockworks",
  "src_dlnews",
  "src_helius_blog",
  "src_chainalysis"
]);
