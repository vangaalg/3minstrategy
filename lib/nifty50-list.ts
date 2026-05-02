/**
 * Nifty 50 constituent list.
 * Breeze API expects ICICI's internal stock codes (not NSE symbols).
 *
 * The mapping below uses Breeze stock_code values. If Breeze returns
 * "stock not found" for any of these, check Breeze's stock master list
 * via /customerdetails/stock_list endpoint.
 *
 * This list reflects the Nifty 50 composition — re-sync periodically
 * because NSE rebalances the index roughly every 6 months.
 */

export const NIFTY_50_BREEZE_CODES: { breeze: string; symbol: string; name: string }[] = [
  { breeze: "RELIND", symbol: "RELIANCE",   name: "Reliance Industries" },
  { breeze: "TCS",    symbol: "TCS",        name: "Tata Consultancy Services" },
  { breeze: "HDFBAN", symbol: "HDFCBANK",   name: "HDFC Bank" },
  { breeze: "ICIBAN", symbol: "ICICIBANK",  name: "ICICI Bank" },
  { breeze: "INFTEC", symbol: "INFY",       name: "Infosys" },
  { breeze: "BHAART", symbol: "BHARTIARTL", name: "Bharti Airtel" },
  { breeze: "ITC",    symbol: "ITC",        name: "ITC" },
  { breeze: "STABAN", symbol: "SBIN",       name: "State Bank of India" },
  { breeze: "LARTOU", symbol: "LT",         name: "Larsen & Toubro" },
  { breeze: "HINUNI", symbol: "HINDUNILVR", name: "Hindustan Unilever" },
  { breeze: "AXIBAN", symbol: "AXISBANK",   name: "Axis Bank" },
  { breeze: "BAJFI",  symbol: "BAJFINANCE", name: "Bajaj Finance" },
  { breeze: "MARSUZ", symbol: "MARUTI",     name: "Maruti Suzuki" },
  { breeze: "KOTBAN", symbol: "KOTAKBANK",  name: "Kotak Mahindra Bank" },
  { breeze: "MAHMAH", symbol: "M&M",        name: "Mahindra & Mahindra" },
  { breeze: "SUNPHA", symbol: "SUNPHARMA",  name: "Sun Pharmaceutical" },
  { breeze: "HCLTEC", symbol: "HCLTECH",    name: "HCL Technologies" },
  { breeze: "NTPC",   symbol: "NTPC",       name: "NTPC" },
  { breeze: "TITIND", symbol: "TITAN",      name: "Titan Company" },
  { breeze: "ULTCEM", symbol: "ULTRACEMCO", name: "UltraTech Cement" },
  { breeze: "POWGRI", symbol: "POWERGRID",  name: "Power Grid" },
  { breeze: "ONGC",   symbol: "ONGC",       name: "Oil & Natural Gas" },
  { breeze: "TATSTE", symbol: "TATASTEEL",  name: "Tata Steel" },
  { breeze: "WIPRO",  symbol: "WIPRO",      name: "Wipro" },
  { breeze: "ADAPOR", symbol: "ADANIPORTS", name: "Adani Ports & SEZ" },
  { breeze: "BAJAUT", symbol: "BAJAJ-AUTO", name: "Bajaj Auto" },
  { breeze: "ASIPAI", symbol: "ASIANPAINT", name: "Asian Paints" },
  { breeze: "TATMOT", symbol: "TATAMOTORS", name: "Tata Motors" },
  { breeze: "JSWSTE", symbol: "JSWSTEEL",   name: "JSW Steel" },
  { breeze: "GRASIM", symbol: "GRASIM",     name: "Grasim Industries" },
  { breeze: "NESIND", symbol: "NESTLEIND",  name: "Nestlé India" },
  { breeze: "HINZIN", symbol: "HINDALCO",   name: "Hindalco Industries" },
  { breeze: "DRRED",  symbol: "DRREDDY",    name: "Dr Reddy's Laboratories" },
  { breeze: "TECMAH", symbol: "TECHM",      name: "Tech Mahindra" },
  { breeze: "BAJFIN", symbol: "BAJAJFINSV", name: "Bajaj Finserv" },
  { breeze: "INDOIL", symbol: "IOC",        name: "Indian Oil Corporation" },
  { breeze: "COAIND", symbol: "COALINDIA",  name: "Coal India" },
  { breeze: "EICMOT", symbol: "EICHERMOT",  name: "Eicher Motors" },
  { breeze: "HEROMO", symbol: "HEROMOTOCO", name: "Hero MotoCorp" },
  { breeze: "ADAENT", symbol: "ADANIENT",   name: "Adani Enterprises" },
  { breeze: "CIPLA",  symbol: "CIPLA",      name: "Cipla" },
  { breeze: "BRITAN", symbol: "BRITANNIA",  name: "Britannia Industries" },
  { breeze: "DIVLAB", symbol: "DIVISLAB",   name: "Divi's Laboratories" },
  { breeze: "APOHOS", symbol: "APOLLOHOSP", name: "Apollo Hospitals" },
  { breeze: "BPCL",   symbol: "BPCL",       name: "Bharat Petroleum" },
  { breeze: "TATCON", symbol: "TATACONSUM", name: "Tata Consumer Products" },
  { breeze: "SBILIF", symbol: "SBILIFE",    name: "SBI Life Insurance" },
  { breeze: "HDFLIF", symbol: "HDFCLIFE",   name: "HDFC Life Insurance" },
  { breeze: "LTIMIN", symbol: "LTIM",       name: "LTIMindtree" },
  { breeze: "SHRTRA", symbol: "SHRIRAMFIN", name: "Shriram Finance" },
];
