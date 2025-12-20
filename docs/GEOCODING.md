# Geocoding Guide

[← Back to README](../README.md)

Geocoding converts extracted addresses to map coordinates. Scanner Map supports three providers.

---

## Provider Comparison

| Provider | Cost | Rate Limit | Accuracy | API Key |
|----------|------|------------|----------|---------|
| **Nominatim** | Free | 1 req/sec | Good | Not required |
| **LocationIQ** | Free tier | 60k/day | Good | Required |
| **Google Maps** | Paid | High | Best | Required |

---

## Nominatim (Recommended)

Free geocoding using OpenStreetMap data. No API key required.

### Configuration

```env
GEOCODING_PROVIDER=nominatim
GEOCODING_STATE=MD
GEOCODING_CITY=Baltimore
GEOCODING_COUNTRY=us
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City
```

### Notes

- Rate limited to 1 request per second
- Sufficient for most scanner setups
- Results may be less precise than paid services
- No usage limits

---

## LocationIQ

Free tier with 60,000 requests per day.

### Get API Key

1. Sign up at [LocationIQ](https://locationiq.com/)
2. Create a new access token
3. Copy the token to your `.env`

### Configuration

```env
GEOCODING_PROVIDER=locationiq
LOCATIONIQ_API_KEY=pk.your-api-key
GEOCODING_STATE=MD
GEOCODING_CITY=Baltimore
GEOCODING_COUNTRY=us
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City
```

### Rate Limits

| Plan | Requests/Day | Requests/Second |
|------|--------------|-----------------|
| Free | 60,000 | 2 |
| Starter | 500,000 | 10 |
| Plus | 2,000,000 | 20 |

---

## Google Maps

Most accurate, but paid service.

### Get API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable "Geocoding API"
4. Create credentials → API key
5. (Recommended) Restrict API key to Geocoding API only

### Configuration

```env
GEOCODING_PROVIDER=google
GOOGLE_MAPS_API_KEY=your-api-key
GEOCODING_STATE=MD
GEOCODING_CITY=Baltimore
GEOCODING_COUNTRY=us
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City
```

### Pricing

- $5 per 1,000 requests (first $200/month free)
- ~40,000 free requests per month

---

## Location Settings

These settings help the geocoder find addresses more accurately.

```env
# State abbreviation (e.g., MD, CA, NY)
GEOCODING_STATE=MD

# Primary city/town
GEOCODING_CITY=Baltimore

# Country code (e.g., us, ca, uk)
GEOCODING_COUNTRY=us

# Comma-separated list of valid counties
# Addresses outside these counties will be filtered out
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City,Anne Arundel,Howard
```

### Target Counties

Important for filtering out incorrect geocoding results. Only addresses within these counties will be mapped.

**Example:** If your scanner covers Baltimore area:
```env
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City,Anne Arundel,Howard,Carroll,Harford
```

---

## Talk Group Location Context

Provide location hints for each talk group to improve AI address extraction:

```env
TALK_GROUP_1001=Baltimore City Fire Dispatch - covers Baltimore City
TALK_GROUP_1002=Baltimore County Police - covers Baltimore County suburbs
TALK_GROUP_2001=Anne Arundel Fire - covers Glen Burnie, Annapolis area
```

The AI uses this context when extracting addresses from transcripts.

---

## How It Works

1. **Audio received** → Transcribed to text
2. **AI extraction** → LLM extracts address from transcript
3. **Geocoding** → Address converted to lat/lng coordinates
4. **County filter** → Result checked against `GEOCODING_TARGET_COUNTIES`
5. **Map display** → Valid coordinates displayed on map

---

## Troubleshooting

### No addresses being extracted

- Verify `AI_PROVIDER` settings are correct
- Check AI service is running (Ollama/OpenAI)
- Review `MAPPED_TALK_GROUPS` includes your dispatch channels

### Wrong locations on map

- Add more counties to `GEOCODING_TARGET_COUNTIES`
- Verify `GEOCODING_STATE` and `GEOCODING_CITY` are correct
- Check `TALK_GROUP_XXXX` location descriptions

### "Geocoding failed" errors

- **Nominatim:** Wait for rate limit (1/sec)
- **LocationIQ:** Check API key and quota
- **Google:** Verify billing is enabled

### Addresses outside target area

This is intentional. Addresses geocoded to locations outside your `GEOCODING_TARGET_COUNTIES` are filtered out to prevent false positives.

To include more areas, expand your county list:
```env
GEOCODING_TARGET_COUNTIES=County1,County2,County3,County4
```

---

## Best Practices

1. **Start with Nominatim** - Free and sufficient for most setups
2. **Define all your counties** - Prevent false positives
3. **Add talk group context** - Helps AI extract addresses correctly
4. **Use dispatch channels** - Only map talk groups that contain addresses

