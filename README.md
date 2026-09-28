# Agent Coverage Review

A single page dashboard for AI agent operations in regulated workflows. It looks at one month of task volume across banking, insurance, and government task types and answers: which task types the agent handles end to end today, which ones still escalate to a human, where expanding agent coverage would remove the most manual review hours, and whether that can happen while keeping the exception rate under a safe limit.

Built as a candidate work sample for Brain Co.'s Machine Learning Engineer, Applied AI role. It draws on production LLM, RAG, and agent architecture work, so the framing is technical: calibrated confidence thresholds, verifier prompt chains, and human in the loop routing.

## What it shows

- **Stat tiles**: tasks processed per month, share fully automated today, agent eligible task types over the exception limit, and manual review hours at stake in shadow mode tasks.
- **Handling mix per task**: 100% stacked bars splitting each task's volume into agent end to end clean, agent with an exception caught by QA, and escalated to a human. A toggle switches between today and after the expansion plan.
- **Coverage against exception rate**: each agent eligible task at the current threshold, sized by volume, against the exception limit.
- **Ranked table**: task types ordered by manual hours at stake, with a status: agent live, expand next, guardrail first, live but over limit, or human in the loop. Sortable on every column.
- **Findings**: computed live, including the coverage for exception tradeoff of raising the threshold, the hours a per task threshold would recover over a single global one, how large an exception cut each blocked task needs, and why item count is the wrong ranking.
- **Action plan**: four numbered actions (which task to move to live next, what guardrail to add first, where a human stays the decision maker, and moving to per task calibrated thresholds).
- **Decision impact**: sliders for how many eligible shadow tasks move to live, guardrail exception reduction, and time saved in human assist mode. Outputs reviewer hours removed per month, reviewer FTE, automation rate after the plan, and exceptions reaching QA, plus a curve of hours removed by tasks moved.

The sector filter, confidence threshold, and exception limit drive every view at once.

## Model

Each task has a calibrated confidence distribution and an exception curve:

- Coverage at threshold `t` is logistic around the task's median confidence: `0.97 / (1 + exp((t - median) / 0.025))`.
- Exception rate among auto approved items falls exponentially as the threshold rises: `e0 * exp(-(t - 0.85) / 0.07)`.
- A guardrail scales exception rates down by its reduction without reducing coverage.
- The per task threshold that exactly meets the limit is solved in closed form from the exception curve.
- Tasks involving adverse determinations about a person are policy locked: the agent only assists, and saves a set share of reviewer time.
- A reviewer FTE is 160 hours per month.

## Data

All data is synthetic, generated deterministically in `app.js` from per task parameters (monthly volume, sector mix, manual handling minutes, median confidence, base exception rate). It is not Brain Co.'s data or any customer's data, and the page says so in a visible banner.

## Stack

Plain HTML, CSS, and JavaScript. No build step, no framework, no chart library. Charts are hand built inline SVG (`charts.js`), with a colorblind safe palette validated against the dark surface. All theme values are CSS variables in `styles.css`.

Run it by opening `index.html` through any static file server, or deploy the folder as a static site.

## Author

Vishal Kumar. [Portfolio](https://vishal-kumar-portfolio-six.vercel.app)
