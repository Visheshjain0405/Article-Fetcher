const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const mongoose = require("mongoose");
const winston = require("winston");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Setup logging with Winston
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
    new winston.transports.Console()
  ],
});

// OpenRouter API keys
const OPENROUTER_API_KEYS = [
  "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",
  "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",
  "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",
  "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",
  "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",
];

// MongoDB Connection
const MONGO_URI = "mongodb+srv://visheshj865:Vishesh6609@cluster0.bw0bufi.mongodb.net/telugu_news1";
mongoose.connect(MONGO_URI)
  .then(() => logger.info("✅ MongoDB Connected"))
  .catch(err => logger.error("❌ MongoDB Connection Error:", err));

// Article Schema
const articleSchema = new mongoose.Schema({
  title: String,
  generatedTitle: String,
  link: { type: String, unique: true },
  source: String,
  fullContent: String,
  regeneratedContent: String,
  wordCount: Number,
  seoKeywords: [String],
  metaDescription: String,
  images: [String],
  slug: String,
  createdAt: { type: Date, default: Date.now }
});
const Article = mongoose.model("Article", articleSchema);

// Utility Functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const withRetry = async (fn, retries = 3, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.info(`Retrying (${i + 1}/${retries})...`);
      await sleep(delay);
    }
  }
};

// Fetch articles from source (123Telugu Movie News)
const fetchArticlesFromSource = async () => {
  try {
    const site = {
      url: "https://www.123telugu.com/category/mnews",
      selector: ".pcsl-title",
      name: "123Telugu",
    };

    const { data } = await axios.get(site.url);
    const $ = cheerio.load(data);

    const articles = [];
    $(site.selector).each((i, element) => {
      const title = $(element).find("a").text().trim();
      const link = $(element).find("a").attr("href");
      if (title && link) {
        const fullLink = link.startsWith("http") ? link : `${site.url.split('/category')[0]}${link}`;
        articles.push({ 
          title, 
          link: fullLink, 
          source: site.name,
        });
      }
    });

    logger.info(`Fetched ${articles.length} articles from ${site.name}`);
    return articles.slice(0, 15);
  } catch (error) {
    logger.error("Error fetching article links from source:", error.message);
    return [];
  }
};

// Fetch full article content with images
const fetchFullArticle = async (url, source) => {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const content = $(".entry-content").text().trim();
    
    // Extract images
    const images = [];
    $(".entry-content img").each((i, element) => {
      const src = $(element).attr("src");
      if (src) {
        const fullSrc = src.startsWith("http") ? src : `${url.split('/').slice(0, 3).join('/')}${src}`;
        images.push(fullSrc);
      }
    });

    return { 
      content: content || "Error loading content.",
      images: images.length > 0 ? images : []
    };
  } catch (error) {
    logger.error("Error fetching full article content:", error.message);
    return { content: "Error loading content.", images: [] };
  }
};

// Count words
const countWords = (htmlContent) => {
  const $ = cheerio.load(htmlContent);
  const text = $.text();
  const words = text.split(/\s+/).filter(word => word.length > 0);
  return words.length;
};

// Default SEO Keywords for Telugu movie news
const defaultSeoKeywords = [
  "telugu movie news",
  "tollywood latest updates",
  "telugu cinema gossip",
  "movie reviews telugu",
  "telugu film industry",
  "latest telugu movies",
  "tollywood celebrities",
  "telugu movie releases",
  "telugu cinema news",
  "tollywood gossip 2025",
  "telugu actors news",
  "telugu actresses updates",
  "movie trailers telugu",
  "telugu film reviews",
  "tollywood box office",
  "telugu movie songs",
  "upcoming telugu films",
  "telugu cinema events",
  "tollywood movie rumors",
  "telugu entertainment news",
  "telugu movie premieres",
  "tollywood film updates",
  "telugu celebrity interviews",
  "latest tollywood trends",
  "telugu movie controversies",
  "tollywood shooting updates",
  "telugu film awards",
  "telugu cinema box office",
];

// Regenerate article with AI
const regenerateArticle = async (originalContent, originalTitle, images) => {
  const prompt = `Rewrite this article in a professional HTML format with:
  Write a detailed and engaging article of 600 to 800 words on the given topic. Use an active voice throughout the article, ensuring the content is original and well-structured. Start with a captivating introduction that hooks the reader, followed by clear and organized body paragraphs covering key aspects of the topic. Provide in-depth insights, examples, and relevant information to keep the reader informed and engaged. Conclude with a strong closing that summarizes the main points and leaves a lasting impression. Ensure the tone is informative yet engaging, and avoid repetition. The article should read naturally, as if written by a human.

  Original Content:
  """${originalContent}"""

  Generate an article of 800+ words based on the original title: "${originalTitle}". Return the full content as valid HTML with proper tags, including a new, creative <h1> title at the top. Include these images if relevant: ${JSON.stringify(images)}.

  Return as JSON:
  {
    "content": "HTML content here with <img> tags where appropriate",
    "generatedTitle": "Creative new title",
    "seoKeywords": ["keyword1", "keyword2", ...], // Return 20-30 keywords
    "metaDescription": "A short meta description here",
    "slug": "url-friendly-slug",
    "images": ["image-url-1", "image-url-2"]
  }`;

  for (let i = 0; i < OPENROUTER_API_KEYS.length; i++) {
    const apiKey = OPENROUTER_API_KEYS[i];
    try {
      logger.info(`Attempting to regenerate article with API key ${i + 1}...`);
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "deepseek/deepseek-chat-v3-0324:free",
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 60000,
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error("Invalid API response: No choices returned");
      }

      let rawContent = response.data.choices[0].message.content.trim();
      if (rawContent.startsWith("```json") || rawContent.startsWith("```")) {
        rawContent = rawContent.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
      }

      let jsonResponse;
      try {
        jsonResponse = JSON.parse(rawContent);
      } catch (parseError) {
        throw new Error(`Failed to parse API response as JSON: ${rawContent}`);
      }

      // Ensure minimum keyword count
      jsonResponse.seoKeywords = [
        ...new Set([
          ...(jsonResponse.seoKeywords || []),
          ...defaultSeoKeywords
        ])
      ].slice(0, 30);

      // Ensure images are included
      jsonResponse.images = images.length > 0 ? images : jsonResponse.images || [];
      
      jsonResponse.wordCount = countWords(jsonResponse.content);

      if (jsonResponse.wordCount < 500 || jsonResponse.wordCount > 850) {
        throw new Error(`Generated article word count out of bounds: ${jsonResponse.wordCount} words`);
      }

      logger.info(`Regenerated article: "${jsonResponse.generatedTitle}", word count: ${jsonResponse.wordCount}`);
      return jsonResponse;

    } catch (error) {
      logger.error(`Error with OpenRouter API key ${i + 1}: ${error.message}`, {
        stack: error.stack,
        response: error.response ? error.response.data : null
      });
      if (i === OPENROUTER_API_KEYS.length - 1) throw new Error("All API keys failed");
      await sleep(1000);
    }
  }
};

// Process and save articles
const processAndSaveArticles = async () => {
  let newArticlesCount = 0;
  try {
    const sourceArticles = await fetchArticlesFromSource();

    for (const article of sourceArticles) {
      const existingArticle = await Article.findOne({ link: article.link });
      if (existingArticle) {
        logger.info(`Skipped existing article: ${article.title}`);
        continue;
      }

      const articleData = await withRetry(() => fetchFullArticle(article.link, article.source));
      if (articleData.content === "Error loading content.") {
        logger.error(`Failed to fetch content for: ${article.title}`);
        continue;
      }

      await sleep(1000);
      const regeneratedData = await withRetry(() => 
        regenerateArticle(articleData.content, article.title, articleData.images)
      );

      await Article.updateOne(
        { link: article.link },
        {
          $setOnInsert: {
            title: article.title,
            generatedTitle: regeneratedData.generatedTitle,
            link: article.link,
            source: article.source,
            fullContent: articleData.content,
            regeneratedContent: regeneratedData.content,
            wordCount: regeneratedData.wordCount,
            seoKeywords: regeneratedData.seoKeywords,
            metaDescription: regeneratedData.metaDescription,
            images: regeneratedData.images,
            slug: regeneratedData.slug,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      logger.info(`Saved article: "${regeneratedData.generatedTitle}" with ${regeneratedData.images.length} images`);
      newArticlesCount++;
      await sleep(5000);
    }

    return { message: `Processed ${newArticlesCount} new articles` };
  } catch (error) {
    logger.error("Error processing articles:", error.message);
    throw error;
  }
};

// API Endpoints
app.get("/api/process-articles", async (req, res) => {
  try {
    const result = await processAndSaveArticles();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/articles", async (req, res) => {
  try {
    const articles = await Article.find()
      .select('-fullContent')
      .sort({ createdAt: -1 })
      .limit(20);
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: "Server error retrieving articles" });
  }
});

app.get("/api/articles/:slug", async (req, res) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug }).select('-fullContent');
    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }
    res.json(article);
  }
  catch (error) {
    res.status(500).json({ error: "Server error retrieving article" });
  }
  });

// Schedule processing every 10 minutes
const POLLING_INTERVAL = 10 * 60 * 1000;
setInterval(async () => {
  logger.info("Starting scheduled article processing...");
  await processAndSaveArticles();
  logger.info("Scheduled processing completed.");
}, POLLING_INTERVAL);

// Initial run
processAndSaveArticles().catch(error => logger.error("Initial processing failed:", error.message));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));