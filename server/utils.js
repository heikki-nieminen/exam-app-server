const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const verifyToken = async (req, res, next) => {
	try {
		const token = await req.headers.authorization?.split(' ')[1]
		if (!token) {
			res.status(401).json({success: false, message: "Token was not provided"})
		}
		req.decoded = await jwt.verify(token, process.env.SECRET_KEY)
		next()
	} catch (err) {
		if (err.message === 'jwt expired') {
			res.status(401).json({success: false, message: "Token expired"})
		}
		res.status(401)
	}
}

const isAdmin = async (req, res, next) => {
	try {
		const result = await pool.query('SELECT role FROM public.user WHERE username = $1', [req.decoded.username])
		if (result.rows[0].role === 'admin') {
			next()
		}
	} catch (err) {
		res.status(403).send("Pääsy evätty")
	}
}

const hashPassword = async (password) => {
	return await bcrypt.hash(password, 10)
}

module.exports = {verifyToken, isAdmin, hashPassword}