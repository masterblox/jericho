# Mechanica Prompt Skills — Full Inventory
152 skills across the codebase at `/opt/data/skills/`.

## Agent Ops (Jericho fleet)
| # | Skill | What |
|---|---|---|
| 1 | `jericho-ops` | Jericho fleet startup, reconfigure, health verification |
| 2 | `deepthink` | Structured deliberation before irreversible/expensive decisions |
| 3 | `conductor-bridge` | Multi-agent fleet orchestration, @engineer protocol |
| 4 | `hermes-operations` | Cron management, profile rebuilds, gateway troubleshooting |
| 5 | `design-delegate` | Route design/visual/UI/deck work to Iris |
| 6 | `iris-jericho` | Iris design intelligence layer — visual memory, vault, discovery |
| 7 | `kanban-orchestrator` | Decomposition playbook for orchestrator profiles |
| 8 | `kanban-worker` | Pitfalls and lifecycle for Kanban worker agents |
| 9 | `watchers` | Poll RSS, JSON APIs, GitHub with watermark dedup |
| 10 | `loop-engineering` | Bounded agent loops with budgets, verification, guardrails |
| 11 | `dev-vault-writeback` | Distill build/fix/spike insights into the vault |
| 12 | `project-memory` | Dated, searchable project memory per agent |
| 13 | `memory-wiki` | Durable linked wiki pages from agent memory |
| 14 | `memory-operations` | Safe Hermes persistent memory CRUD |
| 15 | `skill-factory` | Create/improve/retire reusable agent skills |
| 16 | `skill-resolver` | First-task resolver — load this when task is ambiguous |
| 17 | `agent-browser` | Verify web surfaces with real browser (Goliath fallback) |
| 18 | `away-mode` | Phone-first concierge mode when Carlos travels |
| 19 | `soul-grader` | Evaluate agent identity, SOUL.md, lane charter quality |
| 20 | `webhook-subscriptions` | Event-driven agent runs via webhooks |

## Software Dev
| # | Skill | What |
|---|---|---|
| 21 | `plan` | Write actionable markdown plan, no execution |
| 22 | `writing-plans` | Implementation plans: bite-sized tasks, paths, code |
| 23 | `spike` | Throwaway experiments before build |
| 24 | `test-driven-development` | RED-GREEN-REFACTOR enforcement |
| 25 | `simplify-code` | Parallel 3-agent cleanup of recent code |
| 26 | `systematic-debugging` | 4-phase root cause debugging |
| 27 | `requesting-code-review` | Pre-commit review: security scan, quality gates |
| 28 | `subagent-driven-development` | Execute plans via delegate_task subagents |
| 29 | `nextjs-security-hardening` | Next.js + Supabase auth/RBAC/headers |
| 30 | `stripe-best-practices` | Stripe integration patterns |
| 31 | `supabase` | Database, vector search, storage operations |
| 32 | `portless` | Stable .localhost URLs, workspace-safe ports |
| 33 | `emulate` | Local stateful API emulation for 3rd-party services |
| 34 | `hermes-agent-skill-authoring` | Write SKILL.md: frontmatter, validator, quality rules |
| 35 | `debugging-hermes-tui-commands` | Debug Hermes TUI slash commands |
| 36 | `dogfood` | Exploratory QA of web apps |

## Design & Creative
| # | Skill | What |
|---|---|---|
| 37 | `carlos-design` | Carlos's visual artifact workflow — proposals, decks, dashboards |
| 38 | `claude-design` | One-off HTML artifacts (landing, deck, prototype) |
| 39 | `open-design-pdf` | Generate proposals, invoices, business docs as PDF |
| 40 | `mechanica-proposal-design` | Mechanica-branded client proposals |
| 41 | `memories-express-design` | Memories Express card and memory visuals |
| 42 | `architect-ai-terraza` | Terraza marketing site and engine |
| 43 | `design-md` | Google DESIGN.md token spec files |
| 44 | `sketch` | Throwaway HTML mockups, 2-3 variants |
| 45 | `ideation` | Generate project ideas via creative constraints |
| 46 | `popular-web-designs` | 54 real design systems (Stripe, Linear, Vercel) as HTML |
| 47 | `diagram-maker` | Complex systems → diagrams |
| 48 | `architecture-diagram` | Dark-themed SVG cloud/infra diagrams |
| 49 | `excalidraw` | Hand-drawn JSON diagrams |
| 50 | `ascii-art` | pyfiglet, cowsay, boxes |
| 51 | `ascii-video` | Video → colored ASCII MP4/GIF |
| 52 | `social-media-images` | Content calendar → branded PNGs |
| 53 | `foxsy-post-pipeline` | Foxsy social media post production |
| 54 | `foxsy-social-pipeline` | FoxsyAI social card pipeline |
| 55 | `image-text-swap` | Edit text on raster images without source files |
| 56 | `comfyui` | Image/video/audio generation via ComfyUI |
| 57 | `p5js` | Gen art, shaders, interactive, 3D |
| 58 | `pixel-art` | NES/Game Boy/PICO-8 era palettes |
| 59 | `manim-video` | 3Blue1Brown math/algo animations |
| 60 | `touchdesigner-mcp` | Control TouchDesigner via twozero MCP |
| 61 | `baoyu-comic` | Knowledge comics |
| 62 | `baoyu-infographic` | 21 layouts × 21 styles infographics |
| 63 | `pretext` | @chenglou/pretext DOM-free creative demos |

## Content & Social
| # | Skill | What |
|---|---|---|
| 64 | `copywriting` | Marketing copy for any page type |
| 65 | `humanizer` | Strip AI-isms, add real voice |
| 66 | `linkedin-writer` | Human-sounding LinkedIn posts (5 formats) |
| 67 | `brief` | Client/creative briefs |
| 68 | `ad-creative` | Ad creative: headlines, descriptions, images |
| 69 | `ads` | Paid ads: Google, Meta, LinkedIn, TikTok |
| 70 | `affiliate-marketing` | Affiliate strategy and implementation |
| 71 | `ab-testing` | A/B test planning and design |
| 72 | `beat-competitors` | Competitive analysis |
| 73 | `audit` | Marketing/SEO audits |
| 74 | `about-page-generator` | About page content |
| 75 | `build-clusters` | Content cluster strategy |

## ML/MLOps
| # | Skill | What |
|---|---|---|
| 76 | `llama-cpp` | Local GGUF inference + HF Hub |
| 77 | `serving-llms-vllm` | vLLM high-throughput serving |
| 78 | `obliteratus` | Abliterate LLM refusals (diff-in-means) |
| 79 | `dspy` | Declarative LM programs, auto-optimize prompts |
| 80 | `evaluating-llms-harness` | lm-eval-harness benchmarks |
| 81 | `weights-and-biases` | W&B experiment tracking |
| 82 | `huggingface-hub` | hf CLI: search/download/upload |
| 83 | `audiocraft-audio-generation` | MusicGen + AudioGen |
| 84 | `segment-anything-model` | SAM zero-shot segmentation |
| 85 | `3d-model-sourcing` | CAD/BIM/mesh for AI training data |
| 86 | `ai-render-pipeline` | AI image gen pipelines for 3D/model apps |
| 87 | `research-paper-writing` | ML papers for NeurIPS/ICML/ICLR |

## Research
| # | Skill | What |
|---|---|---|
| 88 | `arxiv` | Search arXiv papers |
| 89 | `llm-wiki` | Karpathy's LLM knowledge base |
| 90 | `polymarket` | Prediction market data |
| 91 | `blogwatcher` | Monitor blogs and RSS feeds |
| 92 | `domain-research` | Domain availability, DNS, registrar pricing |
| 93 | `ai-provider-research` | AI model providers, pricing, comparisons |
| 94 | `github-repo-research` | End-to-end GitHub repo analysis |
| 95 | `codebase-inspection` | LOC/language metrics, product capability inventory |

## Tools & Integrations
| # | Skill | What |
|---|---|---|
| 96 | `linear` | Linear GraphQL: issues, projects, teams |
| 97 | `github-issues` | Create/triage/label GitHub issues |
| 98 | `github-pr-workflow` | PR lifecycle: branch, commit, CI, merge |
| 99 | `github-code-review` | Review PRs: diffs, inline comments |
| 100 | `github-repo-management` | Clone/create/fork repos, releases |
| 101 | `github-auth` | GitHub HTTPS tokens, SSH keys, gh login |
| 102 | `notion` | Notion API + ntn CLI |
| 103 | `airtable` | Airtable REST API |
| 104 | `agentic-google-sheets` | Build agent-operable Google Sheets |
| 105 | `google-workspace` | Gmail, Calendar, Drive, Docs, Sheets |
| 106 | `gogcli` | Google Workspace CLI access |
| 107 | `obsidian` | Read/search/create/edit Obsidian notes |
| 108 | `himalaya` | IMAP/SMTP email from terminal |
| 109 | `apple-reminders` | remindctl: add, list, complete |
| 110 | `apple-notes` | memo CLI: create, search, edit |
| 111 | `imessage` | imsg CLI on macOS |
| 112 | `findmy` | FindMy.app device tracking |
| 113 | `xurl` | X/Twitter via xurl CLI |
| 114 | `spotify` | Play, search, queue, manage |
| 115 | `gif-search` | Tenor GIF search via curl |
| 116 | `youtube-content` | Transcripts → summaries, threads, blogs |
| 117 | `nano-pdf` | Edit PDF text via NL prompts |
| 118 | `ocr-and-documents` | Extract text from PDFs/scans |
| 119 | `powerpoint` | .pptx decks, slides, templates |
| 120 | `openhue` | Philips Hue lights via OpenHue CLI |
| 121 | `maps` | Geocode, POIs, routes via OpenStreetMap |
| 122 | `teams-meeting-pipeline` | Teams meeting summary pipeline |
| 123 | `voice-notes` | TTS voice notes as Telegram audio |
| 124 | `petdex` | Animated mascot selection for Hermes |
| 125 | `native-mcp` | MCP client: connect servers, register tools |
| 126 | `codex` | Delegate coding to OpenAI Codex CLI |
| 127 | `claude-code` | Delegate coding to Claude Code CLI |
| 128 | `opencode` | Delegate coding to OpenCode CLI |
| 129 | `jupyter-live-kernel` | Iterative Python via live Jupyter kernel |
| 130 | `ai-cli` | Terminal media-gen tools |
| 131 | `macos-computer-use` | macOS computer-use operations |

## Fun & Misc
| # | Skill | What |
|---|---|---|
| 132 | `minecraft-modpack-server` | Host modded Minecraft servers |
| 133 | `pokemon-player` | Play Pokemon via headless emulator |
| 134 | `songwriting-and-ai-music` | Suno AI music prompts and craft |
| 135 | `heartmula` | Suno-like song generation |
| 136 | `songsee` | Audio spectrograms via CLI |
| 137 | `godmode` | LLM jailbreaking: Parseltongue, GODMODE, ULTRAPLINIAN |

## Productivity (Carlos-specific)
| # | Skill | What |
|---|---|---|
| 138 | `vault-native-operations` | Vault-first thinking for all sessions |
| 139 | `hermes-board-format` | ROOT RULE presentation standard |
| 140 | `ascii-devops-reports` | ASCII art DevOps dashboards |
| 141 | `prompt-like-michael` | Write like Michael Kirsanov |
| 142 | `forward-ready-messages` | Draft messages for Carlos to forward |
| 143 | `client-intel` | WhatsApp exports → structured intel |
| 144 | `read-images` | Route images to vision subagent |
| 145 | `pa-jericho` | PA lane ops — contacts, calendar, people |
| 146 | `brainstorming` | Pre-build ideation when objectives unclear |
| 147 | `computer-use` | General computer-use operations |
| 148 | `check-resolvable` | Walk resolver chain, verify skill reachability |
| 149 | `node-inspect-debugger` | Node.js --inspect + Chrome DevTools |
| 150 | `python-debugpy` | Python debugpy remote (DAP) |
| 151 | `yuanbao` | Yuanbao (元宝) groups |
| 152 | `hermes-agent` | Configure/extend/contribute to Hermes Agent |
