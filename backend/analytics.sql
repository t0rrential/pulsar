-- Select the stack's AnalyticsDatabaseName and AnalyticsWorkGroupName in Athena.
-- dt is the UTC Firehose arrival date, not the client event date. Use a bounded
-- dt predicate to limit scans; adjust the sample range to cover late arrivals.
-- Delivery is buffered for up to 15 minutes under normal conditions; errors
-- and retries can delay it further. DynamoDB remains the live counter source.

-- CTR by creative (event counts, not distinct people).
SELECT creativeid, count_if(type = 'impression') AS impressions,
       count_if(type = 'click') AS clicks,
       CAST(count_if(type = 'click') AS double) /
         NULLIF(count_if(type = 'impression'), 0) AS ctr
FROM events
WHERE dt BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY creativeid
ORDER BY impressions DESC;

-- Hourly impressions by client event time (UTC).
SELECT date_trunc('hour', from_unixtime(ts / 1000.0, 'UTC')) AS hour_utc,
       count(*) AS impressions
FROM events
WHERE dt BETWEEN '2026-01-01' AND '2026-01-31' AND type = 'impression'
GROUP BY 1 ORDER BY 1;

-- Most-seen placements.
SELECT placement, count(*) AS impressions
FROM events
WHERE dt BETWEEN '2026-01-01' AND '2026-01-31' AND type = 'impression'
GROUP BY placement ORDER BY impressions DESC LIMIT 10;

-- Events grouped by provider session. Clients without a session ID are excluded.
SELECT sessionid, count(*) AS events
FROM events
WHERE dt BETWEEN '2026-01-01' AND '2026-01-31' AND sessionid IS NOT NULL
GROUP BY sessionid ORDER BY events DESC;
