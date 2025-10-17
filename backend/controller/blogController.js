const Joi = require("joi");
const fs = require("fs");
const Blog = require("../models/blog");
const {
  BACKEND_SERVER_PATH,
  CLOUD_NAME,
  API_SECRET,
  API_KEY,
} = require("../config/index");
const BlogDTO = require("../dto/blog");
const BlogDetailsDTO = require("../dto/blog-details");
const Comment = require("../models/comment");

const cloudinary = require("cloudinary").v2;

// Configuration
cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
});

const mongodbIdPattern = /^[0-9a-fA-F]{24}$/;

const blogController = {
  async create(req, res, next) {
    // 1. validate req body
    // 2. handle photo storage, naming
    // 3. add to db
    // 4. return response

    // client side -> base64 encoded string -> decode -> store -> save photo's path in db

    const createBlogSchema = Joi.object({
      title: Joi.string().required(),
      author: Joi.string().regex(mongodbIdPattern).required(),
      content: Joi.string().required(),
      photo: Joi.string().required(),
    });

    const { error } = createBlogSchema.validate(req.body);

    if (error) {
      return next(error);
    }

    const { title, author, content, photo } = req.body;

    // read as buffer
    // const buffer = Buffer.from(
    //   photo.replace(/^data:image\/(png|jpg|jpeg);base64,/, ""),
    //   "base64"
    // );

    // allot a random name
    // const imagePath = `${Date.now()}-${author}.png`;

    // save to cloudinary
    let response;

    try {
      response = await cloudinary.uploader.upload(photo);
      // fs.writeFileSync(`storage/${imagePath}`, buffer);
    } catch (error) {
      return next(error);
    }

    // save blog in db
    let newBlog;
    try {
      newBlog = new Blog({
        title,
        author,
        content,
        photoPath: response.url,
      });

      await newBlog.save();
    } catch (error) {
      return next(error);
    }

    const blogDto = new BlogDTO(newBlog);

    return res.status(201).json({ blog: blogDto });
  },
  async getAll(req, res, next) {
    try {
      const blogs = await Blog.find({});

      const blogsDto = [];

      for (let i = 0; i < blogs.length; i++) {
        const dto = new BlogDTO(blogs[i]);
        blogsDto.push(dto);
      }

      return res.status(200).json({ blogs: blogsDto });
    } catch (error) {
      return next(error);
    }
  },
  async getById(req, res, next) {
    // validate id
    // response

    const getByIdSchema = Joi.object({
      id: Joi.string().regex(mongodbIdPattern).required(),
    });

    const { error } = getByIdSchema.validate(req.params);

    if (error) {
      return next(error);
    }

    let blog;

    const { id } = req.params;

    try {
      blog = await Blog.findOne({ _id: id }).populate("author");
    } catch (error) {
      return next(error);
    }

    const blogDto = new BlogDetailsDTO(blog);

    return res.status(200).json({ blog: blogDto });
  },
  async update(req, res, next) {
    // validate

    const updateBlogSchema = Joi.object({
      title: Joi.string().required(),
      content: Joi.string().required(),
      author: Joi.string().regex(mongodbIdPattern).required(),
      blogId: Joi.string().regex(mongodbIdPattern).required(),
      photo: Joi.string(), // 'photo' is optional for updates
    });

    const { error } = updateBlogSchema.validate(req.body);

    if (error) {
      return next(error);
    }

    const { title, content, author, blogId, photo } = req.body;

    let blog;

    try {
      // 1. Find the blog to get the existing photoPath
      blog = await Blog.findOne({ _id: blogId });

      if (!blog) {
        return res.status(404).json({ message: "Blog not found" });
      }
    } catch (error) {
      return next(error);
    }

    let newPhotoPath = blog.photoPath; // Keep the old path by default

    if (photo) {
      // **Logic to delete old photo from Cloudinary and upload new one**

      // 2. Delete the previous photo from Cloudinary
      if (blog.photoPath) {
        const photoUrl = blog.photoPath;
        // Extract the Public ID from the Cloudinary URL
        // Cloudinary URL format: .../v<version>/<public_id>.<ext>
        const urlParts = photoUrl.split("/");
        // Look for the part just before the final segment, which is often the public ID
        // In most cases, the public ID includes folder names but for a simple upload,
        // it's the last part minus the version and extension. 
        // A safer, more direct approach is to rely on how the path is typically structured:
        let publicIdWithExtension = urlParts.pop();
        let versionedPublicId = urlParts.pop(); // This is often the version 'v123456789'

        // This is a common extraction method for simple uploads without explicit public_id setting:
        let publicId = publicIdWithExtension.split(".")[0];
        // If your photos are saved in a specific folder, you'll need a more robust extraction.

        // Example: If URL is '.../image/upload/v123/my_folder/my_file.jpg'
        // urlParts.pop() -> 'my_file.jpg' -> publicIdWithExtension
        // urlParts.pop() -> 'my_folder' -> versionedPublicId (incorrect extraction here)
        // **Best practice is to store the public ID in the DB directly, but using the path extraction:**
        // Re-join the necessary parts if sub-folders are used. For simplicity assuming direct upload:

        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (cloudinaryError) {
          console.error("Cloudinary old image deletion error:", cloudinaryError);
          // Log the error but continue, as the new upload should still proceed.
        }
      }

      // 3. Upload the new photo to Cloudinary
      let response;
      try {
        response = await cloudinary.uploader.upload(photo);
        newPhotoPath = response.url; // Update the path
      } catch (uploadError) {
        // If new photo upload fails, stop the update and return an error
        return next(uploadError);
      }
    }

    // 4. Update the blog document in the database
    try {
      await Blog.updateOne(
        { _id: blogId },
        {
          title,
          content,
          // Only update photoPath if a new photo was uploaded
          photoPath: newPhotoPath,
        }
      );
    } catch (dbError) {
      return next(dbError);
    }

    return res.status(200).json({ message: "blog updated!" });
  },
  async delete(req, res, next) {
    // 1. Validate ID
    const deleteBlogSchema = Joi.object({
      id: Joi.string().regex(mongodbIdPattern).required(),
    });

    const { error } = deleteBlogSchema.validate(req.params);

    if (error) {
      return next(error);
    }

    const { id } = req.params;

    try {
      // 2. Find the blog to get the photoPath
      const blogToDelete = await Blog.findOne({ _id: id });

      if (!blogToDelete) {
        return res.status(404).json({ message: "Blog not found" });
      }

      const photoUrl = blogToDelete.photoPath;

      // 3. Extract the Public ID from the Cloudinary URL
      // The public ID is the part of the URL after the last '/' and before the file extension (if present)
      // Example URL: https://res.cloudinary.com/dvz07a8s2/image/upload/v1678822000/public_id_example.jpg
      const urlParts = photoUrl.split("/");
      let publicIdWithExtension = urlParts.pop(); // Gets 'public_id_example.jpg'
      let publicId = publicIdWithExtension.split(".")[0]; // Gets 'public_id_example'

      // NOTE: This extraction logic works if the public ID is the last segment of the path 
      // and includes an extension. Adjust if you use sub-folders or specific Cloudinary configurations.

      // 4. Delete the image from Cloudinary
      await cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) {
          // You might log this error but continue with database deletion,
          // as failing to delete the image shouldn't prevent deleting the blog record.
          console.error("Cloudinary deletion error:", error);
          // return next(error); // Uncomment this if you want to fail the request on image deletion failure
        }
        console.log(`Cloudinary result for ${publicId}:`, result);
      });

      // 5. Delete blog and comments from DB
      await Blog.deleteOne({ _id: id });
      await Comment.deleteMany({ blog: id });

    } catch (error) {
      // Handles errors from Mongoose queries or unexpected issues
      return next(error);
    }

    return res.status(200).json({ message: "Blog deleted successfully!" });
  },
};

module.exports = blogController;
