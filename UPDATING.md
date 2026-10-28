# Keeping the figures up to date

Every figure that changes lives in `content/figures.json`. Lessons show it with `{{fig:key}}` (or `{{fig:key+}}` to add the "as of" note), so one edit updates every lesson. When you change a figure, update `value`, `display`, `asOf` and `checked` together, and keep `source` and `url` pointing at the primary source.

After any edit: `node tools/build_pages.mjs`, then `node tests/run.js` (it checks every figure has a source, a link and a date).

## After every Budget (last checked: Autumn Budget, 28 October 2026)
Budgets often announce changes that start the next April or later. Check the gov.uk Budget documents, then update any figure whose `refresh` says "after each Budget", plus anything else announced:
- `lisaReplacement` (First Time Buyer ISA, due April 2029), `lisaHomeCap` (20% charge above the cap), `salarySacrificeCap`, `psa` (savings tax 24/44/49% from April 2027), `tradingAllowance` (£3,000 from April 2027), `nlw` (£13.21 from April 2027).
- Each April, move announced changes into the main value (e.g. trading allowance and NLW in April 2027).
- Income tax, NI, ISA and pension allowances if they change.
- Add an "announced, starts <date>" note in the figure's `asOf` rather than changing today's value early.

## After every Bank of England decision (8 a year)
Dates: bankofengland.co.uk → Monetary policy → "Upcoming MPC dates".
- `bankRate`: new rate, date held or changed, next decision date.
- `topEasyAccess`: savings rates follow Bank Rate within weeks (Moneyfacts).
- Read any lesson text that says rates are "rising" or "falling".

## Every month (ONS inflation release, mid-month)
- `cpi`: latest 12-month CPI rate and the month it covers.

## Every April (new tax year, 6 April)
Check gov.uk "Rates and thresholds for employers" and HMRC for the new tax year, then update `taxYear` and every tax figure:
- Income tax: personal allowance, basic/higher/additional rate bands (England, Wales, NI), and the Scottish bands.
- National Insurance: employee rates and thresholds.
- National Minimum Wage and National Living Wage, including the apprentice rate.
- ISA allowances (ISA, Lifetime ISA, Junior ISA).
- Personal Savings Allowance, starting rate for savings, dividend allowance, capital gains annual exempt amount.
- Trading allowance and the self-assessment threshold.
- Pension annual allowance and auto-enrolment thresholds and minimum contributions.
- State Pension (full new State Pension weekly amount).
- Student loan repayment thresholds for each plan.
- Council tax and energy price cap are local or quarterly: check any lesson that quotes an average.

## Every few months
- `cardApr` (average credit card APR, Moneyfacts).
- Any figure whose `refresh` field says so.

## Don't forget
- Never type a changing figure into a lesson as plain text. Add it to `figures.json`.
- Worked examples may use round example numbers ("say inflation is 3.5%"). Say they're examples.
