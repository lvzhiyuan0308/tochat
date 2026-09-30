package org.tochat.app
object Native {
    init { System.loadLibrary("toxbridge") }
    external fun create(config: String): Long
    external fun error(): String
    external fun call(node: Long, command: String): String
    external fun poll(node: Long): String
    external fun destroy(node: Long)
}
