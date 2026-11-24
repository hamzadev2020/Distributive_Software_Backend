import mongoose from "mongoose";
import dotenv from "dotenv";

export const DbConfig =async()=>{
    try {

        const db=await mongoose.connect(process.env.MongoUri);

        console.log("Database Conect")
        
        return db
        
        
    } catch (error) {
        console.log(error)
        
    }
}