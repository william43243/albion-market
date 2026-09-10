package com.albion.market.litert

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.OpenApiTool
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.*

class AlbionTools(private val serverBaseUrl: String, private val context: Context) {

    companion object {
        private const val TAG = "AlbionTools"
        private const val CONNECT_TIMEOUT = 10_000
        private const val READ_TIMEOUT = 15_000
        private const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024
    }

    private val allowedServerBases = setOf(
        "https://west.albion-online-data.com/api/v2/stats",
        "https://europe.albion-online-data.com/api/v2/stats",
        "https://east.albion-online-data.com/api/v2/stats",
    )

    init { require(serverBaseUrl in allowedServerBases) { "Unsupported Albion server" } }

    private val itemsDb: List<JSONObject> by lazy { loadItemsDb() }

    private fun requireKnownItemId(raw: String): String {
        val itemId = raw.trim()
        require(itemsDb.any { it.optString("id") == itemId }) { "Unknown item_id" }
        return itemId
    }

    private fun parseAodpTimestamp(raw: String): Long {
        require(raw.length in 19..35) { "Invalid AODP timestamp" }
        val patterns = if (raw.endsWith("Z") || raw.matches(Regex(".*[+-]\\d{2}:\\d{2}$"))) {
            listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX")
        } else {
            listOf("yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss")
        }
        for (pattern in patterns) {
            val parser = SimpleDateFormat(pattern, Locale.US).apply {
                isLenient = false
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val position = ParsePosition(0)
            val parsed = parser.parse(raw, position)
            if (parsed != null && position.index == raw.length) {
                require(parsed.time <= System.currentTimeMillis() + 5 * 60_000L) { "Future AODP timestamp" }
                return parsed.time
            }
        }
        throw IllegalArgumentException("Invalid AODP timestamp")
    }

    private fun loadItemsDb(): List<JSONObject> {
        return try {
            val json = context.assets.open("items-db.json").bufferedReader().readText()
            val arr = JSONArray(json)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (e: Exception) { Log.e(TAG, "Failed to load items-db.json", e); emptyList() }
    }

    val searchItemTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"search_item","description":"Search for an Albion Online item by name. Returns matching item IDs for use with get_prices/get_history. Always use this first.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Item name to search for"}},"required":["query"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val query = JSONObject(paramsJsonString).getString("query").lowercase()
                val results = JSONArray()
                var count = 0
                for (item in itemsDb) {
                    if (count >= 10) break
                    val name = item.optString("n", "").lowercase()
                    val id = item.optString("id", "").lowercase()
                    if (name.contains(query) || id.contains(query)) {
                        results.put(JSONObject().apply {
                            put("id", item.getString("id")); put("name", item.getString("n"))
                            put("tier", item.optString("t", "?")); put("category", item.optString("c", "?"))
                        }); count++
                    }
                }
                JSONObject().apply { put("results", results); put("hint", "Use the 'id' with get_prices") }.toString()
            } catch (e: Exception) { JSONObject().put("error", e.message ?: "tool error").toString() }
        }
    }

    val getPricesTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_prices","description":"Get current market prices for an Albion item across all cities.","parameters":{"type":"object","properties":{"item_id":{"type":"string","description":"Item ID e.g. T4_ROCK"},"quality":{"type":"integer","description":"Quality 1 to 5"}},"required":["item_id","quality"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val itemId = JSONObject(paramsJsonString).getString("item_id")
                val quality = JSONObject(paramsJsonString).getInt("quality").coerceIn(1, 5)
                val cities = "Caerleon,Bridgewatch,Fort Sterling,Lymhurst,Thetford,Martlock,Brecilien"
                val response = httpGet("$serverBaseUrl/prices/${encodePath(itemId)}.json?locations=${encodeQuery(cities)}&qualities=$quality")
                val prices = JSONArray(response)
                require(prices.length() <= 100) { "Too many price rows" }
                val result = JSONObject(); val cityPrices = JSONArray(); val seen = mutableSetOf<String>()
                for (i in 0 until prices.length()) {
                    val p = prices.getJSONObject(i)
                    if (p.optInt("quality", 1) != quality) continue
                    val city = p.optString("city")
                    require(city.isNotEmpty() && seen.add(city)) { "Invalid or duplicate city" }
                    val sellMin = p.optLong("sell_price_min", 0); val buyMax = p.optLong("buy_price_max", 0)
                    require(sellMin in 0..Int.MAX_VALUE && buyMax in 0..Int.MAX_VALUE) { "Invalid price" }
                    if (sellMin == 0L && buyMax == 0L) continue
                    val sellDate = if (sellMin > 0) p.getString("sell_price_min_date").also { parseAodpTimestamp(it) } else ""
                    val buyDate = if (buyMax > 0) p.getString("buy_price_max_date").also { parseAodpTimestamp(it) } else ""
                    cityPrices.put(JSONObject().apply {
                        put("city", city); put("quality", quality)
                        if (sellMin > 0) { put("sell", sellMin); put("sell_date", sellDate) }
                        if (buyMax > 0) { put("buy", buyMax); put("buy_date", buyDate) }
                    })
                }
                result.put("item", itemId); result.put("prices", cityPrices); result.toString()
            } catch (e: Exception) { JSONObject().put("error", e.message ?: "tool error").toString() }
        }
    }

    val getHistoryTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_history","description":"Get price history for an Albion item.","parameters":{"type":"object","properties":{"item_id":{"type":"string","description":"Item ID"},"quality":{"type":"integer","description":"Quality 1 to 5"},"days":{"type":"integer","description":"Days of history (7,30,90)"}},"required":["item_id","quality","days"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            return try {
                val params = JSONObject(paramsJsonString)
                val itemId = params.getString("item_id"); val quality = params.getInt("quality").coerceIn(1, 5); val days = params.optInt("days", 7)
                val cities = "Caerleon,Bridgewatch,Fort Sterling,Lymhurst,Thetford,Martlock,Brecilien"
                val cal = Calendar.getInstance(); val endDate = formatApiDate(cal)
                cal.add(Calendar.DAY_OF_YEAR, -days); val startDate = formatApiDate(cal)
                val response = httpGet("$serverBaseUrl/history/${encodePath(itemId)}.json?locations=${encodeQuery(cities)}&date=${encodeQuery(startDate)}&end_date=${encodeQuery(endDate)}&time-scale=24&qualities=$quality")
                val history = JSONArray(response); val citySummaries = JSONArray()
                for (i in 0 until history.length()) {
                    val h = history.getJSONObject(i); if (h.optInt("quality", 1) != quality) continue; val data = h.getJSONArray("data")
                    if (data.length() == 0) continue
                    var weightedSum = 0L; var count = 0; var totalVol = 0L; var min = Long.MAX_VALUE; var max = 0L
                    var lastTimestampMillis = Long.MIN_VALUE; var lastPrice = 0L; val seenTimes = mutableSetOf<Long>()
                    for (j in 0 until data.length()) {
                        val d = data.getJSONObject(j); val avg = d.getLong("avg_price"); val volume = d.getLong("item_count")
                        val timestampMillis = parseAodpTimestamp(d.getString("timestamp"))
                        require(avg in 0..Int.MAX_VALUE && volume in 0..Int.MAX_VALUE && seenTimes.add(timestampMillis)) { "Invalid history point" }
                        if (avg <= 0) continue
                        weightedSum = Math.addExact(weightedSum, Math.multiplyExact(avg, volume))
                        totalVol = Math.addExact(totalVol, volume)
                        count++
                        if (avg < min) min = avg; if (avg > max) max = avg
                        if (timestampMillis > lastTimestampMillis) { lastTimestampMillis = timestampMillis; lastPrice = avg }
                    }
                    if (count == 0) continue
                    val weightedAverage = if (totalVol > 0) weightedSum / totalVol else min + (max - min) / 2
                    citySummaries.put(JSONObject().apply {
                        put("city", h.optString("location")); put("quality", quality); put("avg", weightedAverage)
                        put("min", min); put("max", max); put("last", lastPrice); put("volume", totalVol)
                    })
                }
                JSONObject().apply { put("item", itemId); put("period", "${days}d"); put("cities", citySummaries) }.toString()
            } catch (e: Exception) { JSONObject().put("error", e.message ?: "tool error").toString() }
        }
    }

    val getTimeTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_time","description":"Get current date and time.","parameters":{"type":"object","properties":{}}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            val now = Calendar.getInstance()
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
            val day = SimpleDateFormat("EEEE", Locale.ENGLISH).format(now.time)
            return """{"datetime":"${sdf.format(now.time)}","day":"$day"}"""
        }
    }

    val getRouteTool = object : OpenApiTool {
        override fun getToolDescriptionJsonString(): String = """
        {"name":"get_route","description":"Get travel route info between two Albion cities (zones, danger, red zones).","parameters":{"type":"object","properties":{"city_from":{"type":"string","description":"From city"},"city_to":{"type":"string","description":"To city"}},"required":["city_from","city_to"]}}
        """.trimIndent()
        override fun execute(paramsJsonString: String): String {
            val params = JSONObject(paramsJsonString)
            val from = params.getString("city_from"); val to = params.getString("city_to")
            if (from.contains("Brecilien") || to.contains("Brecilien"))
                return JSONObject().apply { put("from", from); put("to", to); put("info", "Avalon Roads only, no safe overland route") }.toString()
            val route = ROUTES.find { (it.from == from && it.to == to) || (it.from == to && it.to == from) }
                ?: return JSONObject().apply { put("from", from); put("to", to); put("error", "Route not found") }.toString()
            return JSONObject().apply {
                put("from", from); put("to", to); put("zones", route.zones)
                put("red_zones", route.red); put("safe", route.red == 0); put("note", route.note)
            }.toString()
        }
    }

    fun allTools(): List<OpenApiTool> = listOf(searchItemTool, getPricesTool, getHistoryTool, getTimeTool, getRouteTool)

    private fun httpGet(urlStr: String): String {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = CONNECT_TIMEOUT; conn.readTimeout = READ_TIMEOUT
        conn.setRequestProperty("User-Agent", "AlbionMarket/1.0")
        return try {
            val status = conn.responseCode
            if (status !in 200..299) throw IllegalStateException("AODP HTTP $status")
            conn.inputStream.bufferedReader().readText()
        } finally { conn.disconnect() }
    }

    private fun encodeQuery(value: String): String = URLEncoder.encode(value, "UTF-8")
    private fun encodePath(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    private fun formatApiDate(cal: Calendar) = "${cal.get(Calendar.MONTH)+1}-${cal.get(Calendar.DAY_OF_MONTH)}-${cal.get(Calendar.YEAR)}"

    data class R(val from: String, val to: String, val zones: Int, val red: Int, val note: String)
    private val ROUTES = listOf(
        R("Fort Sterling","Thetford",6,0,"Safe, mostly blue"), R("Fort Sterling","Lymhurst",6,0,"Safe yellow route"),
        R("Fort Sterling","Caerleon",5,3,"3 red zones, gank hotspot"), R("Fort Sterling","Martlock",9,5,"5 red, cross center"),
        R("Fort Sterling","Bridgewatch",11,8,"8 red, very dangerous"), R("Martlock","Bridgewatch",6,0,"Safe blue/yellow"),
        R("Martlock","Thetford",6,0,"Safe yellow"), R("Martlock","Caerleon",5,3,"3 red zones"),
        R("Martlock","Lymhurst",10,6,"6 red zones"), R("Bridgewatch","Lymhurst",6,0,"Safe yellow"),
        R("Bridgewatch","Caerleon",6,3,"3 red zones"), R("Bridgewatch","Thetford",11,6,"6 red zones"),
        R("Thetford","Caerleon",6,4,"4 red, most dangerous"), R("Thetford","Lymhurst",10,7,"7 red, extremely dangerous"),
        R("Lymhurst","Caerleon",5,3,"3 red zones"),
    )
}
